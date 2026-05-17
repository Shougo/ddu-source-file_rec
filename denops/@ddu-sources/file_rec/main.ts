import type { Context, Item, SourceOptions } from "@shougo/ddu-vim/types";
import { BaseSource } from "@shougo/ddu-vim/source";
import { treePath2Filename } from "@shougo/ddu-vim/utils";

import type { ActionData } from "@shougo/ddu-kind-file";

import type { Denops } from "@denops/std";

import { join } from "@std/path/join";
import { resolve } from "@std/path/resolve";
import { relative } from "@std/path/relative";
import { abortable } from "@std/async/abortable";

type Params = {
  chunkSize: number;
  ignoredDirectories: string[];
  expandSymbolicLink: boolean;
};

type Args = {
  denops: Denops;
  context: Context;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export class Source extends BaseSource<Params> {
  override kind = "file";

  override gather(
    { sourceOptions, sourceParams, context }: Args,
  ): ReadableStream<Item<ActionData>[]> {
    const abortController = new AbortController();

    return new ReadableStream({
      async start(controller) {
        const root = treePath2Filename(
          sourceOptions.path.length != 0 ? sourceOptions.path : context.path,
        );
        const it = walk(
          resolve(root),
          sourceParams.ignoredDirectories,
          abortController.signal,
          sourceParams.chunkSize,
          sourceParams.expandSymbolicLink,
        );
        try {
          for await (const chunk of it) {
            controller.enqueue(chunk);
          }
        } catch (e: unknown) {
          if (e instanceof Error && e.name.includes("AbortReason")) {
            // Ignore AbortReason errors
          } else {
            console.error(e);
          }
        } finally {
          controller.close();
        }
      },

      cancel(reason): void {
        abortController.abort(reason);
      },
    });
  }

  override params(): Params {
    return {
      chunkSize: 1000,
      ignoredDirectories: [".git"],
      expandSymbolicLink: false,
    };
  }
}

// Iterative implementation to avoid deep recursion and reduce redundant
// realPath calls.
async function* walk(
  root: string,
  ignoredDirectories: string[],
  signal: AbortSignal,
  chunkSize: number,
  expandSymbolicLink: boolean,
): AsyncGenerator<Item<ActionData>[]> {
  const ignoredSet = new Set<string>(ignoredDirectories);
  const visited = new Set<string>();

  // Try to resolve real path of root; fallback to root itself on failure.
  try {
    const rootReal = await Deno.realPath(root);
    visited.add(rootReal);
  } catch {
    visited.add(root);
  }

  const stack: string[] = [root];
  let chunk: Item<ActionData>[] = [];

  while (stack.length) {
    const dir = stack.pop()!;
    try {
      for await (const entry of abortable(Deno.readDir(dir), signal)) {
        const abspath = join(dir, entry.name);
        const stat = await readStat(abspath, expandSymbolicLink);

        if (stat === null) {
          // Skip invalid files
          continue;
        }

        if (!stat.isDirectory) {
          const n = chunk.push({
            word: relative(root, abspath),
            status: {
              size: stat.size,
              time: stat.mtime?.getTime(),
            },
            action: {
              path: abspath,
              isDirectory: false,
            },
          });

          if (n >= chunkSize) {
            yield chunk;
            chunk = [];
          }
        } else {
          // Directory
          if (ignoredSet.has(entry.name)) {
            continue;
          }

          if (stat.isSymlink && stat.isDirectory) {
            // Resolve real path for symlinked directory once and skip if
            // already visited
            const real = await Deno.realPath(abspath).catch(() => null);
            if (real && visited.has(real)) {
              // Looped link or already visited
              continue;
            }
            if (real) {
              visited.add(real);
            }
          }

          // Push directory to stack for later traversal
          stack.push(abspath);
        }
      }
    } catch (e: unknown) {
      if (e instanceof Deno.errors.PermissionDenied) {
        // Ignore this error
        // See https://github.com/Shougo/ddu-source-file_rec/issues/2
        continue;
      }
      throw e;
    }
  }

  if (chunk.length) {
    yield chunk;
  }
}

async function readStat(
  path: string,
  expandSymbolicLink: boolean,
): Promise<Deno.FileInfo | null> {
  try {
    const stat = await Deno.lstat(path);
    if (stat.isSymlink && expandSymbolicLink) {
      return {
        ...(await Deno.stat(path)),
        isSymlink: true,
      };
    }
    return stat;
  } catch (_: unknown) {
    // Ignore stat exception
    return null;
  }
}

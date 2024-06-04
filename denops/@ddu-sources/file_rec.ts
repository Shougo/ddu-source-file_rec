import {
  BaseSource,
  Context,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v4.0.0/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v4.0.0/deps.ts";
import { treePath2Filename } from "https://deno.land/x/ddu_vim@v4.0.0/utils.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.7.1/file.ts";

import { join, resolve } from "jsr:@std/path@0.224.0";
import { relative } from "jsr:@std/path@0.204.0";
import { abortable } from "jsr:@std/async@0.224.0";

type Params = {
  chunkSize: 1000;
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
          resolve(root, root),
          sourceParams.ignoredDirectories,
          abortController.signal,
          sourceParams.chunkSize,
          sourceParams.expandSymbolicLink,
        );
        let enqueueSize: number = sourceParams.chunkSize;
        let items: Item<ActionData>[] = [];
        try {
          for await (const chunk of it) {
            items = items.concat(chunk);
            if (items.length >= enqueueSize) {
              enqueueSize = 10 * sourceParams.chunkSize;
              controller.enqueue(items);
              items = [];
            }
          }
          if (items.length) {
            controller.enqueue(items);
          }
        } catch (e: unknown) {
          if (e instanceof DOMException) {
            return;
          }
          console.error(e);
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

async function* walk(
  root: string,
  ignoredDirectories: string[],
  signal: AbortSignal,
  chunkSize: number,
  expandSymbolicLink: boolean,
): AsyncGenerator<Item<ActionData>[]> {
  const walk = async function* (
    dir: string,
  ): AsyncGenerator<Item<ActionData>[]> {
    let chunk: Item<ActionData>[] = [];
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
            action: {
              path: abspath,
              isDirectory: false,
            },
          });
          if (n >= chunkSize) {
            yield chunk;
            chunk = [];
          }
        } else if (ignoredDirectories.includes(entry.name)) {
          continue;
        } else if (
          stat.isSymlink && stat.isDirectory &&
          abspath.includes(await Deno.realPath(abspath))
        ) {
          // Looped link
          continue;
        } else {
          yield* walk(abspath);
        }
      }
      if (chunk.length) {
        yield chunk;
      }
    } catch (e: unknown) {
      if (e instanceof Deno.errors.PermissionDenied) {
        // Ignore this error
        // See https://github.com/Shougo/ddu-source-file_rec/issues/2
        return;
      }
      throw e;
    }
  };
  yield* walk(root);
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

import {
  type Context,
  type Item,
  type SourceOptions,
} from "jsr:@shougo/ddu-vim@~10.4.0/types";
import { BaseSource } from "jsr:@shougo/ddu-vim@~10.4.0/source";
import { QuitAbortReason } from "jsr:@shougo/ddu-vim@~10.4.0/state";
import { treePath2Filename } from "jsr:@shougo/ddu-vim@~10.4.0/utils";

import { type ActionData } from "jsr:@shougo/ddu-kind-file@~0.9.0";

import type { Denops } from "jsr:@denops/core@~7.0.0";

import { join } from "jsr:@std/path@~1.1.0/join";
import { resolve } from "jsr:@std/path@~1.1.0/resolve";
import { relative } from "jsr:@std/path@~1.1.0/relative";
import { abortable } from "jsr:@std/async@~1.0.4/abortable";

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

function isQuitAbortReason(e: unknown): e is QuitAbortReason {
  return Boolean(
    e &&
      typeof e === "object" &&
      "type" in e &&
      (e as QuitAbortReason).type === "quit",
  );
}

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
          if (e instanceof DOMException || isQuitAbortReason(e)) {
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

import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v2.0.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.0.0/deps.ts";
import { join, resolve } from "https://deno.land/std@0.166.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.2/file.ts";
import { relative } from "https://deno.land/std@0.166.0/path/mod.ts";
import { abortable } from "https://deno.land/std@0.166.0/async/mod.ts";

type Params = {
  chunkSize: 1000;
  ignoredDirectories: string[];
};

type Args = {
  denops: Denops;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export class Source extends BaseSource<Params> {
  override kind = "file";

  override gather(
    { denops, sourceOptions, sourceParams }: Args,
  ): ReadableStream<Item<ActionData>[]> {
    const abortController = new AbortController();

    return new ReadableStream({
      async start(controller) {
        const root = sourceOptions.path || await fn.getcwd(denops) as string;
        const it = walk(
          resolve(root, root),
          sourceParams.ignoredDirectories,
          abortController.signal,
          sourceParams.chunkSize,
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
    };
  }
}

async function* walk(
  root: string,
  ignoredDirectories: string[],
  signal: AbortSignal,
  chunkSize: number,
): AsyncGenerator<Item<ActionData>[]> {
  const walk = async function* (
    dir: string,
  ): AsyncGenerator<Item<ActionData>[]> {
    let chunk: Item<ActionData>[] = [];
    try {
      for await (const entry of abortable(Deno.readDir(dir), signal)) {
        const abspath = join(dir, entry.name);

        if (!entry.isDirectory) {
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
        } else {
          if (ignoredDirectories.includes(entry.name)) {
            continue;
          }
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

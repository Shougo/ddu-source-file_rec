import { BaseSource, SourceOptions, Item } from "https://deno.land/x/ddu_vim@v1.2.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v1.2.0/deps.ts";
import { join, resolve } from "https://deno.land/std@0.127.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.2.0/file.ts";
import { relative } from "https://deno.land/std@0.127.0/path/mod.ts";
import { abortable } from "https://deno.land/std@0.127.0/async/abortable.ts";

const chunkSize = 1000;
const enqueueSize1st = 1000;
const enqueueSize2nd = 100000;

type Params = {
  ignoredDirectories: string[];
};

type Args = {
  denops: Denops;
  sourceOptions: SourceOptions;
  sourceParams: Params;
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather({ denops, sourceOptions, sourceParams }: Args): ReadableStream<Item<ActionData>[]> {
    const abortController = new AbortController();

    return new ReadableStream({
      async start(controller) {
        const root = sourceOptions.path || await fn.getcwd(denops) as string;
        const it = walk(
          resolve(root, root),
          sourceParams.ignoredDirectories,
          abortController.signal,
        );
        let enqueueSize = enqueueSize1st;
        let items: Item<ActionData>[] = [];
        try {
          for await (const chunk of it) {
            items = items.concat(chunk);
            if (items.length >= enqueueSize) {
              enqueueSize = enqueueSize2nd;
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

  params(): Params {
    return {
      ignoredDirectories: [".git"],
    };
  }
}

async function* walk(
  root: string,
  ignoredDirectories: string[],
  signal: AbortSignal,
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

import {
  BaseSource,
  Item,
} from "https://deno.land/x/ddu_vim@v0.12.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v0.12.2/deps.ts";
import { join, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.2.0/file.ts";
import { relative } from "https://deno.land/std@0.125.0/path/mod.ts";
import { deferred } from "https://deno.land/std@0.125.0/async/mod.ts";

const chunkSize = 20000;

const aborted = Symbol('aborted');

type Params = {
  ignoredDirectories: string[];
  path: string;
};

type Args = {
  denops: Denops,
  sourceParams: Params,
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather({ denops, sourceParams }: Args): ReadableStream<Item<ActionData>[]> {
    const abortController = new AbortController();

    return new ReadableStream({
      async start(controller) {
        const root = sourceParams.path || await fn.getcwd(denops) as string;
        const it = walk(
          resolve(root, root),
          sourceParams.ignoredDirectories,
          abortController.signal,
        );
        let chunk: Item<ActionData>[] = [];
        try {
          for await (const item of it) {
            chunk.push(item);
            if (chunk.length > chunkSize) {
              controller.enqueue(chunk);
              chunk = [];
            }
          }
          if (chunk.length) {
            controller.enqueue(chunk);
          }
        } catch (e: unknown) {
          if (e === aborted) {
            return;
          }
          console.error(e);
        }
        finally {
          controller.close();
        }
      },

      cancel(reason): void {
        abortController.abort(reason);
      }
    });
  }

  params(): Params {
    return {
      ignoredDirectories: [".git"],
      path: "",
    };
  }
}

async function* walk(
  root: string,
  ignoredDirectories: string[],
  signal: AbortSignal,
): AsyncGenerator<Item<ActionData>> {
  const waiter = deferred<never>();
  signal.addEventListener("abort", () => waiter.reject(aborted));

  const walk = async function* (dir: string): AsyncGenerator<Item<ActionData>> {
    const it = Deno.readDir(dir)[Symbol.asyncIterator]();
    while (true) {
      const { done, value } = await Promise.race([waiter, it.next()]);
      if (done || value == undefined) {
        return;
      }
      const entry = value as Deno.DirEntry;
      const abspath = join(dir, entry.name);

      if (!entry.isDirectory) {
        yield {
          word: relative(root, abspath),
          action: {
            path: abspath,
          },
        };
      } else {
        if (ignoredDirectories.includes(entry.name)) {
          continue;
        }
        yield* walk(abspath);
      }
    }
  };
  yield* walk(root);
}

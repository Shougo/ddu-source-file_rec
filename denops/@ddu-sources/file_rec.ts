import {
  BaseSource,
  Item,
} from "https://deno.land/x/ddu_vim@v0.12.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v0.12.2/deps.ts";
import { join, resolve } from "https://deno.land/std@0.125.0/path/mod.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.2.0/file.ts";
import { relative } from "https://deno.land/std@0.125.0/path/mod.ts";

type Params = {
  ignoredDirectories: string[];
  path: string;
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
  }): ReadableStream<Item<ActionData>[]> {
    return new ReadableStream({
      async start(controller) {
        const maxItems = 20000;

        let dir = args.sourceParams.path;
        if (dir == "") {
          dir = await fn.getcwd(args.denops) as string;
        }

        const tree = async (root: string) => {
          let items: Item<ActionData>[] = [];
          try {
            for await (const entry of Deno.readDir(root)) {
              const path = join(root, entry.name);
              if (!entry.isDirectory) {
                items.push({
                  word: relative(dir, path),
                  action: {
                    path: path,
                  },
                });
              }

              if (
                entry.isDirectory &&
                !args.sourceParams.ignoredDirectories.includes(entry.name)
              ) {
                items = items.concat(await tree(path));
              }

              if (items.length > maxItems) {
                // Update items
                controller.enqueue(items);

                // Clear
                items = [];
              }
            }
          } catch (e: unknown) {
            console.error(e);
          }

          return items;
        };

        controller.enqueue(
          await tree(resolve(dir, dir)),
        );

        controller.close();
      },
    });
  }

  params(): Params {
    return {
      ignoredDirectories: [".git"],
      path: "",
    };
  }
}

/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import type { Loader, Plugin, PluginBuild } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { imageSize } from 'image-size';

export function createImageLoaderWithAttributePlugin(): Plugin {
  return {
    name: 'angular-image-loader-import-attributes',
    setup(build: PluginBuild) {
      build.onLoad({ filter: /\.(png|jpg|jpeg|gif|webp)$/ }, async (args) => {
        const loader = args.with.loader as Loader | undefined;
        if (!loader) {
          return undefined;
        }

        console.log(args);
        console.log(build.initialOptions);

        const originalName = basename(args.path);

        // There is probably a better way, it doesn't handle sub-dir.
        const outputPath = build.initialOptions.assetNames?.replace('[name]', originalName);

        const image = await readFile(args.path);
        const dimensions = imageSize(image);
        const contents = `export default "${originalName}";
         export const width = ${dimensions.width};
         export const height = ${dimensions.height};
         `;
        return {
          contents,
        };
      });
    },
  };
}

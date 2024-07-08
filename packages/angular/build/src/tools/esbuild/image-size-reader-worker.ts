/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import remapping, { SourceMapInput } from '@ampproject/remapping';
import { PluginObj, parseSync, transformFromAstAsync, types, type NodePath } from '@babel/core';
import assert from 'node:assert';
import { workerData } from 'node:worker_threads';
import { assertIsError } from '../../utils/error';
import * as fs from 'fs';
import * as path from 'path';
import { imageSize } from 'image-size';

// Extract the application files and common options used for inline requests from the Worker context
// TODO: Evaluate overall performance difference of passing translations here as well
const { files, shouldOptimize } = (workerData || {}) as {
  files: ReadonlyMap<string, Blob>;
  shouldOptimize: boolean;
};

/**
 * Inlines staic image dimensions when the image directive is used
 * This function is the main entry for the Worker's action that is called by the worker pool.
 *
 * @param request An InlineRequest object representing the options for inlining
 * @returns An array containing the inlined file and optional map content.
 */
export default async function inlineStaticImageDimensions(request: { filename: string }) {
  const data = files.get(request.filename);

  assert(data !== undefined, `Invalid inline request for file '${request.filename}'.`);

  const code = await data.text();
  const map = await files.get(request.filename + '.map')?.text();
  const result = await transformWithBabel(
    code,
    map && (JSON.parse(map) as SourceMapInput),
    request,
  );

  return {
    file: request.filename,
    code: result.code,
    map: result.map,
  };
}

/**
 * Creates the needed Babel plugins to inline a given locale and translation for a JavaScript file.
 * @param locale A string containing the locale specifier to use.
 * @param translation A object record containing locale specific messages to use.
 * @returns An array of Babel plugins.
 */
function createPlugins(dirname: string) {
  const plugins: PluginObj[] = [];

  plugins.push({
    name: 'inline-static-image-dimensions',
    visitor: {
      CallExpression(callPath: NodePath<types.CallExpression>, state) {
        const { callee, arguments: args } = callPath.node;
        if (types.isIdentifier(callee)) {
          console.log(callee.name);
        }
        if (types.isIdentifier(callee) && callee.name === 'ɵɵoptimizedImage' && args.length > 0) {
          const arg = args[0];
          if (types.isStringLiteral(arg)) {
            const imgPath = arg.value;
            if (/\.(jpg|jpeg|png|gif|svg|webp)$/.test(imgPath)) {
              const imagePath = path.resolve(dirname, imgPath);
              console.log('path', imagePath);
              if (fs.existsSync(imagePath)) {
                const dimensions = imageSize(imagePath);
                if (dimensions) {
                  console.log(
                    `Image: ${imgPath}, Width: ${dimensions.width}, Height: ${dimensions.height}`,
                    '\n',
                  );

                  const { width, height } = dimensions;
                  if (!width || !height) {
                    console.log('ici ????', '\n');
                    // TODO: throw a warning;
                    return;
                  }
                  console.log('la!!!!!!!', '\n');
                  // Create new arguments for width and height
                  const widthArg = types.numericLiteral(width);
                  const heightArg = types.numericLiteral(height);

                  // Add width and height to the call expression arguments
                  callPath.node.arguments.push(widthArg, heightArg);
                }
              }
            }
          }
        }
      },
    },
  });

  return plugins;
}

/**
 * Transforms a JavaScript file using Babel to inline the request locale and translation.
 * @param code A string containing the JavaScript code to transform.
 * @param map A sourcemap object for the provided JavaScript code.
 * @param options The inline request options to use.
 * @returns An object containing the code, map, and diagnostics from the transformation.
 */
async function transformWithBabel(
  code: string,
  map: SourceMapInput | undefined,
  options: { filename: string },
) {
  let ast;
  try {
    ast = parseSync(code, {
      babelrc: false,
      configFile: false,
      sourceType: 'unambiguous',
      filename: options.filename,
    });
  } catch (error) {
    assertIsError(error);

    // Make the error more readable.
    // Same errors will contain the full content of the file as the error message
    // Which makes it hard to find the actual error message.
    const index = error.message.indexOf(')\n');
    const msg = index !== -1 ? error.message.slice(0, index + 1) : error.message;
    throw new Error(`${msg}\nAn error occurred inlining image size in file "${options.filename}"`);
  }

  if (!ast) {
    throw new Error(`Unknown error occurred inlining file "${options.filename}"`);
  }

  // TODO should come from param
  const plugins = createPlugins('src');

  const transformResult = await transformFromAstAsync(ast, code, {
    filename: options.filename,
    // false is a valid value but not included in the type definition
    inputSourceMap: false as unknown as undefined,
    sourceMaps: !!map,
    compact: shouldOptimize,
    configFile: false,
    babelrc: false,
    browserslistConfigFile: false,
    plugins,
  });

  if (!transformResult || !transformResult.code) {
    throw new Error(`Unknown error occurred processing bundle for "${options.filename}".`);
  }

  let outputMap;
  if (map && transformResult.map) {
    outputMap = remapping([transformResult.map as SourceMapInput, map], () => null);
  }

  return { code: transformResult.code, map: outputMap && JSON.stringify(outputMap) };
}

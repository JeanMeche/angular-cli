/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import assert from 'node:assert';
import Piscina from 'piscina';
import { BuildOutputFile, BuildOutputFileType, BundleContextResult } from './bundler-context';
import { createOutputFile } from './utils';
import { ExecutionResult } from './bundler-execution-result';

const OPTIMIZED_IMAGE_INSTRUCTION = '\\u0275\\u0275optimizedImage';

/**
 * Inlining options that should apply to all transformed code.
 */
export interface ImageOptions {
  outputFiles: BuildOutputFile[];
  shouldOptimize?: boolean;
  bundlingResult: BundleContextResult;
}

/**
 * A class that performs i18n translation inlining of JavaScript code.
 * A worker pool is used to distribute the transformation actions and allow
 * parallel processing. Inlining is only performed on code that contains the
 * localize function (`$localize`).
 */
export class StaticImageSizeReader {
  #workerPool: Piscina;
  readonly #filesWithOptimizedImage: ReadonlyMap<string, Blob>;
  readonly #unmodifiedFiles: Array<BuildOutputFile>;
  readonly #fileToType = new Map<string, BuildOutputFileType>();

  constructor(options: ImageOptions, private executionResult: ExecutionResult, maxThreads?: number) {
    this.#unmodifiedFiles = [];

    const files = new Map<string, Blob>();
    const pendingMaps: any[] = [];

    for (const file of options.outputFiles) {
      if (file.type === BuildOutputFileType.Root) {
        // Skip stats and similar files.
        continue;
      }

      this.#fileToType.set(file.path, file.type);

      if (file.path.endsWith('.js') || file.path.endsWith('.mjs')) {
        const contentBuffer = Buffer.isBuffer(file.contents)
          ? file.contents
          : Buffer.from(file.contents.buffer, file.contents.byteOffset, file.contents.byteLength);
        const hasOptimizedImage = contentBuffer.includes(OPTIMIZED_IMAGE_INSTRUCTION);

        if (hasOptimizedImage) {
          executionResult.addLog(file.path);
          console.log('found', file.path);
          // A Blob is an immutable data structure that allows sharing the data between workers
          // without copying until the data is actually used within a Worker. This is useful here
          // since each file may not actually be processed in each Worker and the Blob avoids
          // unneeded repeat copying of potentially large JavaScript files.
          files.set(file.path, new Blob([file.contents]));

          continue;
        }
      } else if (file.path.endsWith('.js.map')) {
        // The related JS file may not have been checked yet. To ensure that map files are not
        // missed, store any pending map files and check them after all output files.
        pendingMaps.push(file);
        continue;
      }

      this.#unmodifiedFiles.push(file);
    }

    // Check if any pending map files should be processed by checking if the parent JS file is present
    for (const file of pendingMaps) {
      if (files.has(file.path.slice(0, -4))) {
        files.set(file.path, new Blob([file.contents]));
      } else {
        this.#unmodifiedFiles.push(file);
      }
    }

    this.#filesWithOptimizedImage = files;

    this.#workerPool = new Piscina({
      filename: require.resolve('./image-size-reader-worker'),
      maxThreads,
      // Extract options to ensure only the named options are serialized and sent to the worker
      workerData: {
        shouldOptimize: options.shouldOptimize,
        files,
      },
      recordTiming: false,
    });
  }

  /**
   * Performs inlining of translations for the provided locale and translations. The files that
   * are processed originate from the files passed to the class constructor and filter by presence
   * of the localize function keyword.
   * @param locale The string representing the locale to inline.
   * @param translation The translation messages to use when inlining.
   * @returns A promise that resolves to an array of OutputFiles representing a translated result.
   */
  async inlineStaticFileDimensions(): Promise<{ outputFiles: BuildOutputFile[] }> {
    this.executionResult.addLog('*********');
    const requests = [];
    for (const filename of this.#filesWithOptimizedImage.keys()) {
      if (filename.endsWith('.map')) {
        continue;
      }

      const fileRequest = this.#workerPool.run({
        filename,
      });
      requests.push(fileRequest);
    }

    // Wait for all file requests to complete
    const rawResults = await Promise.all(requests);

    const outputFiles = [
      ...rawResults.flatMap(({ file, code, map, messages }) => {
        const type = this.#fileToType.get(file);
        assert(type !== undefined, 'file should always have a type' + file);

        const resultFiles = [createOutputFile(file, code, type)];
        if (map) {
          resultFiles.push(createOutputFile(file + '.map', map, type));
        }

        return resultFiles;
      }),
      ...this.#unmodifiedFiles.map((file) => file.clone()),
    ];

    outputFiles.forEach((f) => {
      this.executionResult.addLog(Buffer.from(f.contents).toString().slice(-3000));
    });

    return {
      outputFiles,
    };
  }

  /**
   * Stops all active transformation tasks and shuts down all workers.
   * @returns A void promise that resolves when closing is complete.
   */
  close(): Promise<void> {
    return this.#workerPool.destroy();
  }
}

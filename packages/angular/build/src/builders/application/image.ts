/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.dev/license
 */

import {
  BuildOutputFile,
  BuildOutputFileType,
  BundleContextResult,
  InitialFileRecord,
} from '../../tools/esbuild/bundler-context';
import { ExecutionResult } from '../../tools/esbuild/bundler-execution-result';
import { maxWorkers } from '../../utils/environment-options';
import { NormalizedApplicationBuildOptions } from './options';
import { StaticImageSizeReader } from '../../tools/esbuild/image-size-reader';

/**
 * Inlines all active locales as specified by the application build options into all
 * application JavaScript files created during the build.
 * @param options The normalized application builder options used to create the build.
 * @param executionResult The result of an executed build.
 * @param initialFiles A map containing initial file information for the executed build.
 */
export async function inlineStaticImageDimensions(
  options: NormalizedApplicationBuildOptions,
  executionResult: ExecutionResult,
  bundlingResult: BundleContextResult,
  files: BuildOutputFile[],
): Promise<void> {
  executionResult.addWarning('yoyoyoyoyoyoyoy')
  // Create the multi-threaded inliner with common options and the files generated from the build.
  const inliner = new StaticImageSizeReader(
    {
      bundlingResult,
      outputFiles: files,
      shouldOptimize: options.optimizationOptions.scripts,
    },
    executionResult,
    maxWorkers,
  );

  try {
    let result = await inliner.inlineStaticFileDimensions();
    
    executionResult.outputFiles = [
      // Root files are not modified.
      ...executionResult.outputFiles.filter(({ type }) => type === BuildOutputFileType.Root),
      ...result.outputFiles,
    ];
    executionResult.addLog('foobar')
  } finally {
    await inliner.close();
  }
}

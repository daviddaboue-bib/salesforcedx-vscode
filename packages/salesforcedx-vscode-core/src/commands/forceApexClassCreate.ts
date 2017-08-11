/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import {
  Command,
  SfdxCommandBuilder
} from '@salesforce/salesforcedx-utils-vscode/out/src/cli';
import * as path from 'path';
import * as vscode from 'vscode';
import fs = require('fs');
import { nls } from '../messages';
import {
  CancelResponse,
  ContinueResponse,
  DirFileNameSelection,
  ParametersGatherer,
  SfdxCommandlet,
  SfdxCommandletExecutor,
  SfdxWorkspaceChecker
} from './commands';

function getDirs(srcPath: string) {
  return fs
    .readdirSync(srcPath)
    .map(name => path.join(srcPath, name))
    .filter(source => fs.lstatSync(source).isDirectory());
}

function flatten(lists: string[][]) {
  return lists.reduce((a, b) => a.concat(b), []);
}

function getDirsRecursive(srcPath: string, prioritize?: string): string[] {
  const unprioritizedDirs = [
    srcPath,
    ...flatten(getDirs(srcPath).map(src => getDirsRecursive(src)))
  ];
  if (prioritize) {
    const notPrioritized: string[] = [];
    const prioritized = unprioritizedDirs.filter(dir => {
      if (dir.includes(prioritize)) {
        return true;
      } else {
        notPrioritized.push(dir);
      }
    });
    return prioritized.concat(notPrioritized);
  }
  return unprioritizedDirs;
}

class SelectFilePath implements ParametersGatherer<DirFileNameSelection> {
  private explorerDir: string | undefined;
  public constructor(explorerDir?: { path: string }) {
    this.explorerDir = explorerDir ? explorerDir.path : explorerDir;
  }
  public async gather(): Promise<
    CancelResponse | ContinueResponse<DirFileNameSelection>
  > {
    const rootPath = vscode.workspace.rootPath ? vscode.workspace.rootPath : '';
    const fileNameInputOptions = <vscode.InputBoxOptions>{
      prompt: nls.localize('force_apex_class_create_enter_file_name')
    };

    const fileName = await vscode.window.showInputBox(fileNameInputOptions);
    const outputdir = this.explorerDir
      ? this.explorerDir
      : await vscode.window.showQuickPick(
          getDirsRecursive(rootPath, 'classes'),
          <vscode.QuickPickOptions>{
            placeHolder: nls.localize('force_apex_class_create_enter_dir_name')
          }
        );
    return fileName && outputdir
      ? {
          type: 'CONTINUE',
          data: { fileName, outputdir }
        }
      : { type: 'CANCEL' };
  }
}

class ForceApexClassCreateExecutor extends SfdxCommandletExecutor<
  DirFileNameSelection
> {
  public build(data: {
    template: string;
    fileName: string;
    outputdir: string;
  }): Command {
    const fswatcher = vscode.workspace.createFileSystemWatcher(
      '**/*.cls',
      false,
      true,
      true
    );
    fswatcher.onDidCreate(function(e) {
      vscode.workspace
        .openTextDocument(e)
        .then(document => vscode.window.showTextDocument(document));
      fswatcher.dispose();
    });
    return new SfdxCommandBuilder()
      .withDescription(nls.localize('force_apex_class_create'))
      .withArg('force:apex:class:create')
      .withFlag('--classname', data.fileName)
      .withFlag('--template', 'DefaultApexClass')
      .withFlag('--outputdir', data.outputdir)
      .build();
  }
}

const workspaceChecker = new SfdxWorkspaceChecker();

export async function forceApexClassCreate(explorerDir?: any) {
  const parameterGatherer = new SelectFilePath(explorerDir);
  const commandlet = new SfdxCommandlet(
    workspaceChecker,
    parameterGatherer,
    new ForceApexClassCreateExecutor()
  );
  commandlet.run();
}
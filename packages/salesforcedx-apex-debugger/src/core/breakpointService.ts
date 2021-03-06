/*
 * Copyright (c) 2017, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */

import {
  CliCommandExecutor,
  CommandOutput,
  SfdxCommandBuilder
} from '@salesforce/salesforcedx-utils-vscode/out/src/cli';
import {
  ApexBreakpointLocation,
  LineBreakpointsInTyperef
} from '../breakpoints/lineBreakpoint';
import { RequestService } from '../commands';

export class BreakpointService {
  private static instance: BreakpointService;
  private lineNumberMapping: Map<
    string,
    LineBreakpointsInTyperef[]
  > = new Map();
  private typerefMapping: Map<string, string> = new Map();
  private breakpointCache: Map<string, ApexBreakpointLocation[]> = new Map();

  public static getInstance() {
    if (!BreakpointService.instance) {
      BreakpointService.instance = new BreakpointService();
    }
    return BreakpointService.instance;
  }

  public setValidLines(
    lineNumberMapping: Map<string, LineBreakpointsInTyperef[]>,
    typerefMapping: Map<string, string>
  ): void {
    this.lineNumberMapping = lineNumberMapping;
    this.typerefMapping = typerefMapping;
  }

  public hasLineNumberMapping(): boolean {
    return this.lineNumberMapping && this.lineNumberMapping.size > 0;
  }

  public isApexDebuggerBreakpointId(id: string): boolean {
    return id != null && id.startsWith('07b');
  }

  public getTyperefFor(uri: string, line: number): string | undefined {
    const linesInTyperefs = this.lineNumberMapping.get(uri);
    if (linesInTyperefs) {
      for (const linesInTyperef of linesInTyperefs) {
        if (linesInTyperef.lines.indexOf(line) >= 0) {
          return linesInTyperef.typeref;
        }
      }
    }
  }

  public getSourcePathFromTyperef(typeref: string): string | undefined {
    return this.typerefMapping.get(typeref);
  }

  public getSourcePathFromPartialTyperef(
    partialTyperef: string
  ): string | undefined {
    for (const typeref of this.typerefMapping.keys()) {
      if (typeref.endsWith(partialTyperef)) {
        return this.typerefMapping.get(typeref);
      }
    }
  }

  public cacheBreakpoint(
    uriArg: string,
    lineArg: number,
    breakpointIdArg: string
  ) {
    if (!this.breakpointCache.has(uriArg)) {
      this.breakpointCache.set(uriArg, []);
    }
    this.breakpointCache.get(uriArg)!.push({
      line: lineArg,
      breakpointId: breakpointIdArg
    });
  }

  public getBreakpointCache(): Map<string, ApexBreakpointLocation[]> {
    return this.breakpointCache;
  }

  public getBreakpointsFor(uri: string): Set<number> {
    const lines: Set<number> = new Set();
    const existingBreakpoints = this.breakpointCache.get(uri);
    if (existingBreakpoints) {
      for (const breakpointInfo of existingBreakpoints) {
        lines.add(breakpointInfo.line);
      }
    }
    return lines;
  }

  public async createLineBreakpoint(
    projectPath: string,
    sessionId: string,
    typeref: string,
    line: number
  ): Promise<string | undefined> {
    const execution = new CliCommandExecutor(
      new SfdxCommandBuilder()
        .withArg('force:data:record:create')
        .withFlag('--sobjecttype', 'ApexDebuggerBreakpoint')
        .withFlag(
          '--values',
          `SessionId='${sessionId}' FileName='${typeref}' Line=${line} IsEnabled='true' Type='Line'`
        )
        .withArg('--usetoolingapi')
        .withArg('--json')
        .build(),
      { cwd: projectPath, env: RequestService.getEnvVars() }
    ).execute();

    const cmdOutput = new CommandOutput();
    const result = await cmdOutput.getCmdResult(execution);
    try {
      const breakpointId = JSON.parse(result).result.id as string;
      if (this.isApexDebuggerBreakpointId(breakpointId)) {
        return Promise.resolve(breakpointId);
      } else {
        return Promise.reject(result);
      }
    } catch (e) {
      return Promise.reject(result);
    }
  }

  public async deleteLineBreakpoint(
    projectPath: string,
    breakpointId: string
  ): Promise<string | undefined> {
    const execution = new CliCommandExecutor(
      new SfdxCommandBuilder()
        .withArg('force:data:record:delete')
        .withFlag('--sobjecttype', 'ApexDebuggerBreakpoint')
        .withFlag('--sobjectid', breakpointId)
        .withArg('--usetoolingapi')
        .withArg('--json')
        .build(),
      { cwd: projectPath, env: RequestService.getEnvVars() }
    ).execute();
    const cmdOutput = new CommandOutput();
    const result = await cmdOutput.getCmdResult(execution);
    try {
      const deletedBreakpointId = JSON.parse(result).result.id as string;
      if (this.isApexDebuggerBreakpointId(deletedBreakpointId)) {
        return Promise.resolve(deletedBreakpointId);
      } else {
        return Promise.reject(result);
      }
    } catch (e) {
      return Promise.reject(result);
    }
  }

  public async reconcileBreakpoints(
    projectPath: string,
    uri: string,
    sessionId: string,
    clientLines: number[]
  ): Promise<Set<number>> {
    const knownBreakpoints = this.breakpointCache.get(uri);
    if (knownBreakpoints) {
      for (
        let knownBpIdx = knownBreakpoints.length - 1;
        knownBpIdx >= 0;
        knownBpIdx--
      ) {
        const knownBp = knownBreakpoints[knownBpIdx];
        if (clientLines.indexOf(knownBp.line) === -1) {
          try {
            const breakpointId = await this.deleteLineBreakpoint(
              projectPath,
              knownBp.breakpointId
            );
            if (breakpointId) {
              knownBreakpoints.splice(knownBpIdx, 1);
            }
            // tslint:disable-next-line:no-empty
          } catch (error) {}
        }
      }
    }
    for (const clientLine of clientLines) {
      if (
        !knownBreakpoints ||
        !knownBreakpoints.find(
          knownBreakpoint => knownBreakpoint.line === clientLine
        )
      ) {
        const typeref = this.getTyperefFor(uri, clientLine);
        if (typeref) {
          try {
            const breakpointId = await this.createLineBreakpoint(
              projectPath,
              sessionId,
              typeref,
              clientLine
            );
            if (breakpointId) {
              this.cacheBreakpoint(uri, clientLine, breakpointId);
            }
            // tslint:disable-next-line:no-empty
          } catch (error) {}
        }
      }
    }
    return Promise.resolve(this.getBreakpointsFor(uri));
  }

  public clearSavedBreakpoints(): void {
    this.breakpointCache.clear();
  }
}

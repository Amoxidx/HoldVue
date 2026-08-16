import { readFile, rename, writeFile } from 'node:fs/promises';
import type { PortfolioState } from './state.ts';
import { createEmptyPortfolioState, parsePortfolioState } from './state.ts';

export interface StateStorage {
  load(): Promise<PortfolioState>;
  save(state: PortfolioState): Promise<void>;
}

export class JsonFileStateStorage implements StateStorage {
  private readonly filename: string;

  public constructor(filename: string) {
    this.filename = filename;
  }

  public async load(): Promise<PortfolioState> {
    try {
      const raw = await readFile(this.filename, 'utf8');
      return parsePortfolioState(JSON.parse(raw) as unknown);
    } catch {
      return createEmptyPortfolioState();
    }
  }

  public async save(state: PortfolioState): Promise<void> {
    const temporary = `${this.filename}.tmp`;
    await writeFile(temporary, JSON.stringify(parsePortfolioState(state), null, 2), 'utf8');
    await rename(temporary, this.filename);
  }
}

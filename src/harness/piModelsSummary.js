import { readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

function modelsPath() {
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return path.join(home, '.pi', 'agent', 'models.json');
}

export async function getPiModelsSummary() {
  const filePath = modelsPath();
  try {
    await access(filePath, constants.F_OK);
  } catch {
    return { present: false, path: filePath, providers: [], models: [], modelCount: 0 };
  }

  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const providers = Object.entries(raw.providers || {}).map(([name, provider]) => {
      const models = (provider?.models || []).map((model) => ({
        id: model?.id,
        name: model?.name || model?.id,
        contextWindow: model?.contextWindow,
        reasoning: model?.reasoning,
      }));
      return { name, modelCount: models.length, models };
    });
    const models = providers.flatMap((provider) => provider.models.map((model) => ({
      ...model,
      provider: provider.name,
    })));
    return {
      present: true,
      path: filePath,
      providers: providers.map(({ name, modelCount }) => ({ name, modelCount })),
      models: models.slice(0, 40),
      modelCount: models.length,
    };
  } catch (error) {
    return {
      present: true,
      path: filePath,
      parseError: error.message,
      providers: [],
      models: [],
      modelCount: 0,
    };
  }
}

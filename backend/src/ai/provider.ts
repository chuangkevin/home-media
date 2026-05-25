import { OpenCodeProviderAdapter } from '@kevinsisi/ai-core';
import {
  getOpenCodeServers,
  getOpenCodeTextModel,
  getOpenCodeTextVariant,
  getOpenCodePassword,
  type OpenCodeServer,
} from './opencode-settings';

export type BuiltAdapter = {
  adapter: OpenCodeProviderAdapter;
  model: string;
  server: OpenCodeServer;
};

function parseModelRef(model: string): { providerID: string; id: string } {
  const slash = model.indexOf('/');
  if (slash > 0 && slash < model.length - 1) {
    return { providerID: model.slice(0, slash), id: model.slice(slash + 1) };
  }
  return { providerID: 'openai', id: model };
}

export function buildOpenCodeAdapters(): BuiltAdapter[] {
  const servers = getOpenCodeServers();
  if (servers.length === 0) return [];
  const password = getOpenCodePassword();
  const variant = getOpenCodeTextVariant();
  const model = getOpenCodeTextModel();
  return servers.map(server => ({
    server,
    model,
    adapter: new OpenCodeProviderAdapter(
      {
        type: 'api',
        provider: 'opencode',
        apiKey: password,
        baseURL: server.baseUrl,
        credentialLabel: server.id,
      },
      {
        defaultModel: parseModelRef(model),
        basicAuth: !!password,
        variant,
      }
    ),
  }));
}

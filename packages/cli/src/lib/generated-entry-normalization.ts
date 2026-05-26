export function generateBuiltModuleNormalizationSource(): string {
	return `
function normalizeBuiltModules(agentModules, workflowModules, channelModules) {
  const manifest = { agents: [], workflows: [] };
  const directHandlers = {};
  const localAgentHandlers = {};
  const createdAgents = {};
  const deployedAgentNames = new Map();
  const workflowHandlers = {};
  const localWorkflowHandlers = {};
  const websocketAgentHandlers = {};
  const websocketWorkflowHandlers = {};
  const agentRouteMiddleware = {};
  const agentWebSocketMiddleware = {};
  const workflowRouteMiddleware = {};
  const workflowWebSocketMiddleware = {};
  const channelApps = {};
  for (const [name, mod] of Object.entries(agentModules)) {
    if (!mod.default || mod.default.__flueCreatedAgent !== true || typeof mod.default.initialize !== 'function') throw new Error('[flue] Agent "' + name + '" must default-export createAgent(...).');
    if (mod.route !== undefined && typeof mod.route !== 'function') throw new Error('[flue] Agent "' + name + '" route export must be a callable Hono middleware value.');
    if (mod.websocket !== undefined && typeof mod.websocket !== 'function') throw new Error('[flue] Agent "' + name + '" websocket export must be a callable Hono middleware value.');
    const channels = normalizeChannelList(mod.channels, 'agent "' + name + '"');
    if (typeof mod.route === 'function') channels.http = true;
    if (typeof mod.websocket === 'function') channels.websocket = true;
    assertDirectChannels(channels, 'agent "' + name + '"');
    manifest.agents.push({ name, channels, created: true });
    createdAgents[name] = mod.default;
    const previousDeployedName = deployedAgentNames.get(mod.default);
    if (previousDeployedName !== undefined) throw new Error('[flue] Agents "' + previousDeployedName + '" and "' + name + '" default-export the same created agent value. Use distinct createAgent(...) values for deployed agent modules.');
    deployedAgentNames.set(mod.default, name);
    localAgentHandlers[name] = createDirectAgentHandler(mod.default);
    if (channels.http) directHandlers[name] = localAgentHandlers[name];
    if (channels.websocket) websocketAgentHandlers[name] = localAgentHandlers[name];
    if (typeof mod.route === 'function') agentRouteMiddleware[name] = mod.route;
    if (typeof mod.websocket === 'function') agentWebSocketMiddleware[name] = mod.websocket;
  }

  for (const [name, mod] of Object.entries(workflowModules)) {
    if (typeof mod.run !== 'function') throw new Error('[flue] Workflow "' + name + '" must export a callable run value.');
    if (mod.route !== undefined && typeof mod.route !== 'function') throw new Error('[flue] Workflow "' + name + '" route export must be a callable Hono middleware value.');
    if (mod.websocket !== undefined && typeof mod.websocket !== 'function') throw new Error('[flue] Workflow "' + name + '" websocket export must be a callable Hono middleware value.');
    const channels = normalizeChannelList(mod.channels, 'workflow "' + name + '"');
    if (typeof mod.route === 'function') channels.http = true;
    if (typeof mod.websocket === 'function') channels.websocket = true;
    assertDirectChannels(channels, 'workflow "' + name + '"');
    manifest.workflows.push({ name, channels });
    localWorkflowHandlers[name] = mod.run;
    if (channels.http) workflowHandlers[name] = mod.run;
    if (channels.websocket) websocketWorkflowHandlers[name] = mod.run;
    if (typeof mod.route === 'function') workflowRouteMiddleware[name] = mod.route;
    if (typeof mod.websocket === 'function') workflowWebSocketMiddleware[name] = mod.websocket;
  }

  for (const [name, mod] of Object.entries(channelModules)) {
    if (!mod.default || mod.default.__flueDefinedChannel !== true || typeof mod.default.on !== 'function' || typeof mod.default.emit !== 'function') {
      throw new Error('[flue] Channel "' + name + '" must default-export defineChannel({ app }).');
    }
    if (mod.default.app !== undefined) {
      if (!mod.default.app || typeof mod.default.app.fetch !== 'function') throw new Error('[flue] Channel "' + name + '" app must be a Hono application with a fetch method.');
      channelApps[name] = mod.default.app;
    }
  }

  return { manifest, directHandlers, localAgentHandlers, createdAgents, deployedAgentNames, workflowHandlers, localWorkflowHandlers, websocketAgentHandlers, websocketWorkflowHandlers, agentRouteMiddleware, agentWebSocketMiddleware, workflowRouteMiddleware, workflowWebSocketMiddleware, channelApps };
}

function normalizeChannelList(value, label) {
  if (value === undefined) return {};
  if (!Array.isArray(value)) throw new Error('[flue] channels export for ' + label + ' must be an array.');
  const result = {};
  for (const entry of value) {
    const definition = normalizeChannelExport(entry, label + ' channel');
    result[definition.name] = true;
  }
  return result;
}

function normalizeChannelExport(value, label) {
  const definition = typeof value === 'function' ? value() : value;
  if (!definition || typeof definition !== 'object' || definition.__flueChannel !== true || typeof definition.name !== 'string' || definition.name.trim() === '') {
    throw new Error('[flue] Invalid ' + label + ': expected a channel definition or zero-argument channel factory.');
  }
  return definition;
}

function assertDirectChannels(channels, label) {
  for (const channel of Object.keys(channels)) {
    if (channel !== 'http' && channel !== 'websocket') {
      throw new Error('[flue] ' + label + ' has unsupported attached channel "' + channel + '". Only http() and websocket() are supported.');
    }
  }
}
`;
}

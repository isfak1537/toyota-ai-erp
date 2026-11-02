// A scripted LLM for integration tests. Replace the shared service with one that answers from `script`.
const { createLlmService } = require("../../src/modules/ai/llm/llm.service");
const { LlmError } = require("../../src/modules/ai/llm/provider");

const installFakeLlm = ({ reply = "Stock is below the reorder point, so an order is suggested.", fail = false } = {}) => {
  const requests = [];
  const state = { reply, fail, requests };
  const provider = {
    name: "fakegroq",
    model: "fake-model",
    chat: async (request) => {
      requests.push(request);

      if (state.fail) throw new LlmError("HTTP_500");

      return typeof state.reply === "function"
        ? state.reply(request)
        : { content: state.reply, toolCalls: [], usage: { promptTokens: 1, completionTokens: 1 } };
    },
  };

  return { state, service: createLlmService({ providers: [provider], limiter: { tryAcquire: async () => null } }) };
};

module.exports = { installFakeLlm };

/**
 * Routing configuration for the Telegram Bot.
 * Defines which models are used for different types of queries.
 */

const ROUTES = [
  {
    id: "accounting",
    description: "Financial analysis, invoices, taxes, and complex accounting tasks",
    keywords: [
      "инвойс",
      "счет",
      "бухгалтерия",
      "отчет",
      "налоги",
      "invoice",
      "tax",
      "accounting",
    ],
    model: "ollama/gemma4:31b",
  },
  {
    id: "search",
    description: "Web search, finding information, prices, and news",
    keywords: [
      "найди",
      "поиск",
      "гугл",
      "google",
      "search",
      "сколько стоит",
      "find",
      "price",
    ],
    model: "ollama/gemma4:latest",
  },
  {
    id: "chat",
    description: "General conversation, greetings, and simple questions",
    keywords: ["привет", "как дела", "кто ты", "hello", "hi", "who are you"],
    model: "ollama/gemma4:latest",
  },
];

module.exports = { ROUTES };

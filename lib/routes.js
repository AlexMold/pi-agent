/**
 * Routing configuration for the Telegram Bot.
 * Defines which models are used for different types of queries.
 */

const ROUTES = [
  {
    id: "planning",
    description: "Planning, scheduling, tasks, reminders, and daily routine organization",
    keywords: [
      "расписание",
      "план",
      "задача",
      "напоминать",
      "планирование",
      "schedule",
      "plan",
      "task",
      "reminder",
      "routine"
    ],
    model: "ollama/gemma4:latest"
  },
  {
    id: "productivity",
    description: "Advice on productivity, habits, focus, and personal development",
    keywords: [
      "продуктивность",
      "привычка",
      "фокус",
      "мотивация",
      "совет",
      "productivity",
      "habit",
      "focus",
      "motivation",
      "tip",
      "advice"
    ],
    model: "ollama/gemma4:latest"
  },
  {
    id: "search",
    description: "Web search, finding information, news, and general knowledge",
    keywords: [
      "найди",
      "поиск",
      "гугл",
      "google",
      "search",
      "как сделать",
      "что такое",
      "how to",
      "what is",
      "find",
      "price",
      "news"
    ],
    model: "ollama/gemma4:latest"
  },
  {
    id: "chat",
    description: "General conversation, greetings, and simple questions",
    keywords: ["привет", "как дела", "кто ты", "hello", "hi", "who are you"],
    model: "ollama/gemma4:latest"
  }
];

module.exports = { ROUTES };

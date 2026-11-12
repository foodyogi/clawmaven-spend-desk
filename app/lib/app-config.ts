const rawAppName = "clawmaven-spend-desk";
const rawAppTitle = "ClawMaven Spend Desk";

const APP_NAME_PLACEHOLDER = "{" + "{APP_NAME}}";
const APP_TITLE_PLACEHOLDER = "{" + "{APP_TITLE}}";

export const APP_NAME =
  rawAppName === APP_NAME_PLACEHOLDER ? "chat" : rawAppName;

export const APP_TITLE =
  rawAppTitle === APP_TITLE_PLACEHOLDER ? "Chat" : rawAppTitle;
export const APP_VERSION = "0.1.13";

export const APP_DESCRIPTION =
  "An AI agent pays contractors through PayPal Payouts (sandbox): small payouts run automatically, larger ones wait for human approval, and anything over the monthly budget is blocked. Every attempt writes a receipt.";

/** Route meta: "<page> — ClawMaven Spend Desk" plus the app description. */
export function pageMeta(page?: string) {
  return [
    { title: page ? `${page} — ${APP_TITLE}` : APP_TITLE },
    { name: "description", content: APP_DESCRIPTION },
  ];
}

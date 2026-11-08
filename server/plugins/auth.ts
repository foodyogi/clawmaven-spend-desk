import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  rootAuth: true,
  marketing: {
    appName: "ClawMaven Spend Desk",
    tagline:
      "Governed agent payouts. Small ones pay, big ones wait for you, over-budget ones never leave.",
  },
});

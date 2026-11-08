import HomePage from "@/components/home/HomePage";
import { APP_DESCRIPTION, APP_TITLE } from "@/lib/app-config";

const SEO_TITLE = `${APP_TITLE} - AI contractor payouts with budget guardrails`;
const SEO_DESCRIPTION = APP_DESCRIPTION;

export function meta() {
  return [
    { title: SEO_TITLE },
    {
      name: "description",
      content: SEO_DESCRIPTION,
    },
    { property: "og:title", content: SEO_TITLE },
    { property: "og:description", content: SEO_DESCRIPTION },
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: SEO_TITLE },
    { name: "twitter:description", content: SEO_DESCRIPTION },
  ];
}

export default function HomeRoute() {
  return <HomePage />;
}

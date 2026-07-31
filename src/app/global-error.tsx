"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import NextError from "next/error";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html>
      <body>
        {/* NextError is the default Next.js error page component. Its type
         * definition requires a `statusCode` prop, but since the App Router
         * does not expose status codes for errors, 0 is a valid placeholder. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/clerk-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./styles.css";

const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
const key = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      {key ? <ClerkProvider publishableKey={key}><App /></ClerkProvider> : <App devNoClerk />}
    </QueryClientProvider>
  </StrictMode>,
);

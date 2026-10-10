import { useEffect, useState, type ReactNode } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BackgroundArt } from "@/components/art";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LIFT_EVENT } from "@/lib/beat";
import { useTheme } from "@/lib/theme";
import Landing from "@/pages/Landing";
import RunView from "@/pages/RunView";
import Runs from "@/pages/Runs";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

/** A route change: the new page rises in with the shared entrance easing. */
function RouteStage({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <div key={pathname} className="route-enter">
      {children}
    </div>
  );
}

function Header() {
  const theme = useTheme();
  // The one flourish: the wordmark lifts when a replayed run verifies (see lib/beat.ts).
  const [lifted, setLifted] = useState(false);
  useEffect(() => {
    let id = 0;
    const on = () => {
      setLifted(true);
      window.clearTimeout(id);
      id = window.setTimeout(() => setLifted(false), 560);
    };
    window.addEventListener(LIFT_EVENT, on);
    return () => {
      window.removeEventListener(LIFT_EVENT, on);
      window.clearTimeout(id);
    };
  }, []);
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded px-1 py-1 text-sm font-semibold underline-offset-8 hover:text-foreground ${isActive ? "text-foreground underline" : "text-muted-foreground"}`;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="Resurgo, home" className="flex items-center">
          {/* The brand's lifted-r wordmark; the file is chosen for the background it sits on. */}
          <img
            src={theme === "dark" ? "/brand/logo-wordmark-dark.svg" : "/brand/logo-wordmark-light.svg"}
            alt="resurgo"
            width={120}
            height={28}
            className={`h-7 w-auto ${lifted ? "lift" : ""}`}
          />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 sm:gap-6">
          <NavLink to="/runs" className={link}>Runs</NavLink>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Resurgo, pronounced reh-SUR-go: Latin for &ldquo;I rise again&rdquo;. Built for neatHack, 10 to 12 October 2026.</p>
        <p className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <a href="/index.md" className="font-semibold text-foreground underline underline-offset-4">Agent view</a>
          <span>Not affiliated with the tools or repositories named on this site.</span>
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-foreground focus:px-3 focus:py-2 focus:text-background">
        Skip to content
      </a>
      <BackgroundArt />
      <Header />
      <div id="main">
        <RouteStage>
        <ErrorBoundary label="This page" page>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunView />} />
          <Route
            path="*"
            element={<main className="mx-auto max-w-3xl px-6 py-24"><h1 className="text-4xl font-semibold">Page not found</h1><p className="mt-4"><Link className="underline" to="/">Back to the start</Link></p></main>}
          />
        </Routes>
        </ErrorBoundary>
        </RouteStage>
      </div>
      <Footer />
    </BrowserRouter>
  );
}

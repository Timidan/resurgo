import { useEffect } from "react";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { BackgroundArt } from "@/components/art";
import Landing from "@/pages/Landing";
import RunView from "@/pages/RunView";
import Runs from "@/pages/Runs";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => window.scrollTo(0, 0), [pathname]);
  return null;
}

function Header() {
  const link = ({ isActive }: { isActive: boolean }) =>
    `rounded px-1 py-1 text-sm font-semibold underline-offset-8 hover:text-foreground ${isActive ? "text-foreground underline" : "text-muted-foreground"}`;
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link to="/" aria-label="Resurgo, home" className="flex items-center">
          <img src="/brand/logo-wordmark-dark.svg" alt="resurgo" width={120} height={28} className="h-7 w-auto" />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-6">
          <NavLink to="/runs" className={link}>Runs</NavLink>
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
        <p>Not affiliated with the tools or repositories named on this site.</p>
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
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/runs/:id" element={<RunView />} />
          <Route
            path="*"
            element={<main className="mx-auto max-w-3xl px-6 py-24"><h1 className="text-4xl font-semibold">Page not found</h1><p className="mt-4"><Link className="underline" to="/">Back to the start</Link></p></main>}
          />
        </Routes>
      </div>
      <Footer />
    </BrowserRouter>
  );
}

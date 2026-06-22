import { AnnouncementBar } from "./components/AnnouncementBar";
import { SiteNav } from "./components/SiteNav";
import { Hero } from "./components/Hero";
import { Features } from "./components/Features";
import { Themes } from "./components/Themes";
import { Download } from "./components/Download";
import { SiteFooter } from "./components/SiteFooter";

export function App() {
  return (
    <div className="flex min-h-full flex-col">
      <AnnouncementBar />
      <SiteNav />
      <main id="top" className="flex-1">
        <Hero />
        <Features />
        <Themes />
        <Download />
      </main>
      <SiteFooter />
    </div>
  );
}

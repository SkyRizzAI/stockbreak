import "./landing.css";
import { LandingHeader } from "./header";
import { Hero } from "./hero";
import { HowItWorks, IndexToken, Mandate, MarketStrip, PreIpo, Problem } from "./sections-a";
import { Agents, Creators, Social } from "./sections-b";
import {
  Compare,
  Faq,
  FinalCta,
  LandingFooter,
  type ProgramIds,
  Tests,
  Trust,
  TryIt,
  WhoFor,
  WhySolana,
} from "./sections-c";

/** Public landing page (refs/Stockbreak.html "Landing 1 + 2"); the app lives under /home. */
export function Landing({ programs }: { programs: ProgramIds }) {
  return (
    <div className="relative flex min-h-full flex-col overflow-x-clip bg-background">
      <LandingHeader />
      <main className="flex-1">
        <Hero />
        <MarketStrip />
        <Problem />
        <HowItWorks />
        <IndexToken />
        <Mandate />
        <PreIpo />
        <Creators />
        <Agents />
        <Social />
        <WhoFor />
        <Compare />
        <WhySolana />
        <Trust programs={programs} />
        <Tests />
        <TryIt />
        <Faq />
        <FinalCta />
      </main>
      <LandingFooter />
    </div>
  );
}

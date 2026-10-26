import { createFileRoute } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { Agents } from "@/components/agents";
import { Features } from "@/components/features";
import { Footer } from "@/components/footer";
import { Hero } from "@/components/hero";
import { Roadmap } from "@/components/roadmap";
import { SiteNav } from "@/components/site-nav";
import { Workflow } from "@/components/workflow";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  return (
    <MotionConfig reducedMotion="user">
      <SiteNav />
      <main>
        <Hero />
        <Workflow />
        <Features />
        <Agents />
        <Roadmap />
      </main>
      <Footer />
    </MotionConfig>
  );
}

'use client';

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { ChevronRight, Star, ThumbsUp, ThumbsDown, RefreshCw, SlidersHorizontal, Search, Settings, Bell, BookmarkPlus, Sparkles } from "lucide-react";

// Types

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  postedAt?: string;
  description?: string;
  source: string;
  tags?: string[];
  salaryMin?: number;
  salaryMax?: number;
  workType?: "Full-time" | "Part-time" | "Contract" | "Casual" | "Fixed-term" | string;
  seniority?: "Entry" | "Mid" | "Senior" | "Lead" | "Manager" | "Director" | string;
  remote?: boolean;
  hybrid?: boolean;
};

type Preferences = {
  keywords: string[];
  blockedKeywords: string[];
  preferredLocations: string[];
  excludedLocations: string[];
  minSalary?: number;
  workTypes: string[];
  industries: string[];
  seniority: string[];
  remoteOnly: boolean;
  academia: boolean;
  consulting: boolean;
  publicSector: boolean;
  privateSector: boolean;
  weights: Record<string, number>;
};

// [rest of the file remains unchanged]



// -------------------------------
// Utilities
// -------------------------------

const STORAGE_KEY = "pathfinder-state-v1";

const defaultPreferences: Preferences = {
  keywords: [
    "organisational psychology",
    "behavioural science",
    "OD",
    "leadership development",
    "culture",
    "statistics",
    "program evaluation",
    "research methods",
    "data analysis",
  ],
  blockedKeywords: ["corruption prevention"],
  preferredLocations: ["Sydney", "NSW", "Hybrid", "Remote"],
  excludedLocations: [],
  minSalary: 140000,
  workTypes: ["Full-time", "Fixed-term", "Contract"],
  industries: ["Consulting", "Tech", "Healthcare", "Higher Education", "Financial Services", "Public Sector"],
  seniority: ["Senior", "Lead", "Manager", "Director"],
  remoteOnly: false,
  academia: true,
  consulting: true,
  publicSector: true,
  privateSector: true,
  weights: {
    keywordMatch: 1.4,
    negativeKeyword: -2.2,
    locationMatch: 0.9,
    salary: 1.2,
    workType: 0.6,
    industry: 0.7,
    seniority: 0.8,
    remote: 0.5,
    recency: 0.6,
  },
};

function saveState(state: any) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadState<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function daysSince(dateIso?: string) {
  if (!dateIso) return 999;
  const d = new Date(dateIso);
  const diff = Date.now() - d.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
// Monkey patch safety for SSR context
if (typeof window !== "undefined") {
  (window as any).__lastFeedback = null;
}
// Extract quick keywords from a job description/title
function extractTags(job: Job): string[] {
  const blob = `${job.title} ${job.description ?? ""}`.toLowerCase();
  const picks = [
    "organisational psychology",
    "behavioural",
    "leadership",
    "culture",
    "od",
    "learning",
    "l&d",
    "people analytics",
    "data",
    "statistics",
    "evaluation",
    "program",
    "policy",
    "consulting",
    "experimental",
    "research",
    "phd",
    "doctorate",
    "university",
    "health",
    "clinical",
    "government",
    "ethics",
    "risk",
    "psychometrics",
    "survey",
  ];
  return picks.filter((p) => blob.includes(p)).slice(0, 12);
}

// -------------------------------
// Minimal Learning-to-Rank Engine
// -------------------------------

function scoreJob(job: Job, prefs: Preferences) {
  const w = prefs.weights;
  const title = job.title.toLowerCase();
  const desc = (job.description || "").toLowerCase();

  // Base: keyword matches
  const kwHits = prefs.keywords.reduce((acc, kw) => acc + (title.includes(kw.toLowerCase()) || desc.includes(kw.toLowerCase()) ? 1 : 0), 0);
  const kwScore = kwHits * w.keywordMatch;

  // Negative keywords
  const negHits = prefs.blockedKeywords.reduce((acc, kw) => acc + (title.includes(kw.toLowerCase()) || desc.includes(kw.toLowerCase()) ? 1 : 0), 0);
  const negScore = negHits * w.negativeKeyword;

  // Location preference
  const locationScore = prefs.preferredLocations.some((l) => job.location?.toLowerCase().includes(l.toLowerCase())) ? w.locationMatch : 0;

  // Salary
  const offered = job.salaryMax || job.salaryMin || 0;
  const salaryScore = offered >= (prefs.minSalary || 0) ? w.salary : 0;

  // Work type
  const workTypeScore = job.workType && prefs.workTypes.includes(job.workType) ? w.workType : 0;

  // Industry heuristic via tags
  const industryScore = (job.tags || []).some((t) =>
    prefs.industries.some((i) => t.toLowerCase().includes(i.toLowerCase()))
  )
    ? w.industry
    : 0;

  // Seniority
  const seniorityScore = job.seniority && prefs.seniority.includes(job.seniority) ? w.seniority : 0;

  // Remote
  const remoteScore = job.remote || job.hybrid ? w.remote : 0;

  // Recency boost (under 21 days)
  const d = daysSince(job.postedAt);
  const recencyScore = d < 21 ? w.recency * ((21 - d) / 21) : 0;

  return kwScore + negScore + locationScore + salaryScore + workTypeScore + industryScore + seniorityScore + remoteScore + recencyScore;
}

function reRank(jobs: Job[], prefs: Preferences) {
  const enriched = jobs.map((j) => ({ ...j, tags: j.tags?.length ? j.tags : extractTags(j) }));
  return enriched
    .map((job) => ({ job, score: scoreJob(job, prefs) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.job);
}

// Adapt weights based on feedback
function learnFromFeedback(prefs: Preferences, job: Job, liked: boolean, notes: string, selectedTags: string[]) {
  const delta = liked ? 0.15 : -0.12;
  const newPrefs = { ...prefs, weights: { ...prefs.weights } };

  // Reward keyword matches in liked roles
  if (liked) newPrefs.weights.keywordMatch = clamp(newPrefs.weights.keywordMatch + 0.05, 0.6, 2.2);
  if (!liked) newPrefs.weights.negativeKeyword = clamp(newPrefs.weights.negativeKeyword - 0.05, -3, -0.6);

  // Soft-learn from tags
  (selectedTags.length ? selectedTags : job.tags || []).forEach((t) => {
    const tLower = t.toLowerCase();
    if (liked) {
      if (!newPrefs.keywords.includes(tLower)) newPrefs.keywords = [...newPrefs.keywords, tLower];
    } else {
      if (!newPrefs.blockedKeywords.includes(tLower)) newPrefs.blockedKeywords = [...newPrefs.blockedKeywords, tLower];
    }
  });

  // Notes quick parsing (VERY simple)
  const n = notes.toLowerCase();
  if (n.includes("salary") || n.includes("pay")) newPrefs.weights.salary = clamp(newPrefs.weights.salary + delta, 0.2, 2.4);
  if (n.includes("remote") || n.includes("hybrid")) newPrefs.weights.remote = clamp(newPrefs.weights.remote + delta, 0, 1.4);
  if (n.includes("leadership") || n.includes("manager") || n.includes("director")) newPrefs.weights.seniority = clamp(newPrefs.weights.seniority + delta, 0.2, 2);
  if (n.includes("consult")) newPrefs.consulting = liked;
  if (n.includes("university") || n.includes("academic")) newPrefs.academia = liked;

  return newPrefs;
}

// -------------------------------
// Job Source Adapters (plug your APIs here)
// -------------------------------

/**
 * IMPORTANT: Replace the demo adapter with real ones.
 * Suggested AU sources (respect ToS / use official APIs where available):
 * - SEEK Job Search API (partner access) / RSS exports
 * - I Work For NSW (NSW public sector) search API
 * - APSJobs (Australian Public Service) listings (RSS/API)
 * - LinkedIn Jobs (via approved partner integrations)
 * - University & hospital career pages (RSS if available)
 * - Atlassian, Canva, CSIRO, Big 4, management consulting firms
 */

async function demoAdapter(query: string, location: string): Promise<Job[]> {
  // Simulated sample data for development. Replace with real fetch calls.
  await new Promise((r) => setTimeout(r, 600));
  const now = new Date();
  const iso = (d: number) => new Date(now.getTime() - d * 86400000).toISOString();
  return [
    {
      id: "1",
      title: "Senior People Analytics Consultant",
      company: "BrightPath Consulting",
      location: "Sydney (Hybrid)",
      url: "https://example.com/jobs/1",
      postedAt: iso(3),
      description: "Lead organisational psychology projects, design experiments, and partner with clients on leadership and culture programs. Strong statistics + R/Python preferred.",
      source: "DEMO",
      tags: ["people analytics", "leadership", "consulting", "statistics"],
      salaryMin: 170000,
      salaryMax: 210000,
      workType: "Full-time",
      seniority: "Senior",
      hybrid: true,
    },
    {
      id: "2",
      title: "Director, Behavioural Insights (Health)",
      company: "NSW Health",
      location: "Sydney (Hybrid)",
      url: "https://example.com/jobs/2",
      postedAt: iso(9),
      description: "Direct a small team applying behavioural science to public health programs. Evidence synthesis, RCTs, and complex stakeholder environments.",
      source: "DEMO",
      tags: ["behavioural", "public sector", "leadership", "research"],
      salaryMin: 200000,
      salaryMax: 240000,
      workType: "Fixed-term",
      seniority: "Director",
      hybrid: true,
    },
    {
      id: "3",
      title: "Head of Organisational Development",
      company: "Canva",
      location: "Sydney (Hybrid)",
      url: "https://example.com/jobs/3",
      postedAt: iso(15),
      description: "Own OD strategy: succession, leadership pipelines, culture diagnostics. Strong program evaluation and data storytelling.",
      source: "DEMO",
      tags: ["od", "leadership", "culture", "people analytics"],
      salaryMin: 230000,
      salaryMax: 300000,
      workType: "Full-time",
      seniority: "Director",
      hybrid: true,
    },
    {
      id: "4",
      title: "Senior Lecturer in Organisational Psychology",
      company: "University of Sydney",
      location: "Camperdown NSW (Hybrid)",
      url: "https://example.com/jobs/4",
      postedAt: iso(5),
      description: "Teach and research in organisational psychology. PhD required. Grants, supervision, and applied partnerships encouraged.",
      source: "DEMO",
      tags: ["university", "research", "psychology", "doctoral"],
      salaryMin: 160000,
      salaryMax: 190000,
      workType: "Full-time",
      seniority: "Senior",
      hybrid: true,
    },
  ];
}

const jobAdapters: { name: string; enabled: boolean; fetcher: (q: string, l: string) => Promise<Job[]> }[] = [
  { name: "DEMO", enabled: true, fetcher: demoAdapter },
  // Examples to implement:
  // { name: "SEEK", enabled: false, fetcher: seekAdapter },
  // { name: "IWFNSW", enabled: false, fetcher: iWorkForNSWAdapter },
  // { name: "APSJobs", enabled: false, fetcher: apsJobsAdapter },
  // { name: "UNIVERSITIES", enabled: false, fetcher: uniRssAdapter },
];

async function fetchJobs(query: string, location: string, enabledOnly = true): Promise<Job[]> {
  const adapters = jobAdapters.filter((a) => (enabledOnly ? a.enabled : true));
  const batches = await Promise.allSettled(adapters.map((a) => a.fetcher(query, location)));
  const jobs: Job[] = [];
  batches.forEach((b, i) => {
    if (b.status === "fulfilled") jobs.push(...b.value);
    else console.warn("Adapter failed:", adapters[i].name, b.reason);
  });
  // de-dup
  const map = new Map<string, Job>();
  for (const j of jobs) map.set(`${j.source}-${j.id}`, j);
  return Array.from(map.values());
}

// -------------------------------
// UI Components
// -------------------------------

function SectionHeader({ title, subtitle, icon: Icon }: { title: string; subtitle?: string; icon?: any }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      {Icon ? <Icon className="w-6 h-6" /> : null}
      <div>
        <h2 className="text-xl font-semibold leading-tight">{title}</h2>
        {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="px-2 py-0.5 rounded-full text-xs bg-muted">{children}</span>;
}

function JobCard({ job, onFeedback, onSave }: { job: Job; onFeedback: (job: Job) => void; onSave: (job: Job) => void }) {
  const ago = daysSince(job.postedAt);
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg leading-snug">{job.title}</CardTitle>
            <p className="text-sm text-muted-foreground">{job.company} • {job.location}</p>
          </div>
          <a className="text-sm inline-flex items-center gap-1 hover:underline" href={job.url} target="_blank" rel="noreferrer">
            View <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap gap-2 mb-2">
          {(job.tags || []).slice(0, 8).map((t) => (
            <Badge key={t} variant="secondary">{t}</Badge>
          ))}
        </div>
        <div className="text-sm text-muted-foreground flex flex-wrap items-center gap-3">
          {typeof job.salaryMin !== "undefined" ? (
            <Pill>AUD ${job.salaryMin?.toLocaleString()}–{job.salaryMax?.toLocaleString?.() || "?"}</Pill>
          ) : null}
          {job.workType ? <Pill>{job.workType}</Pill> : null}
          {job.seniority ? <Pill>{job.seniority}</Pill> : null}
          {job.remote ? <Pill>Remote</Pill> : null}
          {job.hybrid ? <Pill>Hybrid</Pill> : null}
          {Number.isFinite(ago) ? <span className="text-xs">Posted {ago} day{ago === 1 ? "" : "s"} ago</span> : null}
        </div>
        <div className="mt-3 flex gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1"><ThumbsUp className="w-4 h-4" /> Rate</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[560px]">
              <DialogHeader>
                <DialogTitle>What do you think of this role?</DialogTitle>
              </DialogHeader>
              <FeedbackForm job={job} onSubmit={() => onFeedback(job)} />
            </DialogContent>
          </Dialog>
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => onSave(job)}>
            <BookmarkPlus className="w-4 h-4" /> Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function FeedbackForm({ job, onSubmit }: { job: Job; onSubmit: (liked: boolean, notes: string, tags: string[]) => void }) {
  const [liked, setLiked] = useState<boolean | null>(null);
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const tags = (job.tags || []).slice(0, 12);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant={liked === true ? "default" : "outline"} onClick={() => setLiked(true)} className="gap-1"><ThumbsUp className="w-4 h-4" /> Like</Button>
        <Button variant={liked === false ? "default" : "outline"} onClick={() => setLiked(false)} className="gap-1"><ThumbsDown className="w-4 h-4" /> Dislike</Button>
      </div>
      <div>
        <Label className="text-sm">What stood out?</Label>
        <div className="flex flex-wrap gap-2 mt-2">
          {tags.map((t) => (
            <Badge key={t} variant={selected.includes(t) ? "default" : "secondary"} className="cursor-pointer" onClick={() => setSelected((s) => (s.includes(t) ? s.filter((x) => x !== t) : [...s, t]))}>{t}</Badge>
          ))}
        </div>
      </div>
      <div>
        <Label className="text-sm">Tell us why</Label>
        <Textarea placeholder="e.g., Love the leadership focus and data rigour; salary feels a bit light; hybrid is a must; not keen on heavy compliance roles." value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div className="flex justify-end">
        <Button disabled={liked === null} onClick={() => onSubmit(liked!, notes, selected)}>Save feedback</Button>
      </div>
    </div>
  );
}

function WeightsEditor({ prefs, setPrefs }: { prefs: Preferences; setPrefs: (p: Preferences) => void }) {
  const entries = Object.entries(prefs.weights);
  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {entries.map(([k, v]) => (
        <div key={k} className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="capitalize">{k.replace(/([A-Z])/g, " $1")}</Label>
            <span className="text-xs text-muted-foreground">{v.toFixed(2)}</span>
          </div>
          <Slider value={[v]} min={-2.5} max={2.5} step={0.05} onValueChange={(arr) => setPrefs({ ...prefs, weights: { ...prefs.weights, [k]: arr[0] } })} />
        </div>
      ))}
    </div>
  );
}

// -------------------------------
// Main App
// -------------------------------

export default function CareerPathfinderApp() {
  const [query, setQuery] = useState("organisational psychology OR people analytics OR behavioural insights");
  const [location, setLocation] = useState("Sydney OR Remote");
  const [prefs, setPrefs] = useState<Preferences>(() => loadState<Preferences>(defaultPreferences));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ranked, setRanked] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<Job[]>(() => {
  try {
    const raw = localStorage.getItem("career-pathfinder-state-v1");
    const parsed = raw ? JSON.parse(raw) : undefined;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
});
  const [weeklyDigest, setWeeklyDigest] = useState<boolean>(() => !!loadState({ weekly: true }).weekly);

  useEffect(() => {
    saveState(prefs);
  }, [prefs]);

  useEffect(() => {
    saveState({ weekly: weeklyDigest });
  }, [weeklyDigest]);

  useEffect(() => {
    setRanked(reRank(jobs, prefs));
  }, [jobs, prefs]);

  async function runSearch() {
    setLoading(true);
    const results = await fetchJobs(query, location);
    setJobs(results);
    setLoading(false);
  }

  function handleFeedback(job: Job) {
    // this callback is invoked by FeedbackForm after onSubmit
    const d = (window as any).__lastFeedback;
    if (!d) return;
    const { liked, notes, tags } = d as { liked: boolean; notes: string; tags: string[] };
    const learned = learnFromFeedback(prefs, job, liked, notes, tags);
    setPrefs(learned);
    // persist feedback log
    const log = loadState<any[]>([]);
    const entry = { jobId: job.id, when: new Date().toISOString(), liked, notes, tags, title: job.title };
    saveState([...log, entry]);
  }

  function handleSave(job: Job) {
    const next = saved.find((j) => j.id === job.id) ? saved : [...saved, job];
    setSaved(next);
    saveState(next);
  }

  // Monkey patch for FeedbackForm -> parent.
  if (typeof window !== "undefined") {
  (window as any).__lastFeedback = null;
  }
  const onFeedbackSubmit = (liked: boolean, notes: string, tags: string[]) => {
  if (typeof window !== "undefined") {
  (window as any).__lastFeedback = { liked, notes, tags };
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Career Pathfinder <span className="text-muted-foreground">— Org Psych Edition</span></h1>
            <p className="text-sm md:text-base text-muted-foreground mt-2">Curated, real-world roles for a doctorate‑level organisational psychologist transitioning beyond corruption prevention. Like/dislike to teach the model what to find next week.</p>
          </div>
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5" />
            <Label className="text-sm">Weekly digest</Label>
            <Switch checked={weeklyDigest} onCheckedChange={setWeeklyDigest} />
          </div>
        </div>
      </header>

      <Tabs defaultValue="discover" className="space-y-6">
        <TabsList>
          <TabsTrigger value="discover"><Search className="w-4 h-4 mr-2" /> Discover</TabsTrigger>
          <TabsTrigger value="preferences"><SlidersHorizontal className="w-4 h-4 mr-2" /> Preferences</TabsTrigger>
          <TabsTrigger value="sources"><Settings className="w-4 h-4 mr-2" /> Sources</TabsTrigger>
          <TabsTrigger value="saved"><Star className="w-4 h-4 mr-2" /> Saved</TabsTrigger>
        </TabsList>

        <TabsContent value="discover" className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Search roles" subtitle="Use natural language for role types, skills, or sectors." icon={Search} />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <Label>Query</Label>
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="e.g., people analytics OR organisational development OR behavioural insights" />
                </div>
                <div>
                  <Label>Location</Label>
                  <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g., Sydney OR NSW OR Remote" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={runSearch} disabled={loading} className="gap-2">
                  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {loading ? "Searching…" : "Search"}
                </Button>
                <Button variant="secondary" onClick={() => setPrefs(defaultPreferences)} title="Reset to sensible defaults">Reset preferences</Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            {ranked.map((job) => (
              <JobCard key={`${job.source}-${job.id}`} job={job} onFeedback={(j) => handleFeedback(j)} onSave={handleSave} />
            ))}
            {(!loading && ranked.length === 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>No results yet</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">Try running a search, or broaden your query/locations.</CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="preferences" className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Your preferences" subtitle="Teach the model what to prioritise. It learns from your feedback automatically." icon={SlidersHorizontal} />
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Keywords</Label>
                  <Textarea value={prefs.keywords.join(", ")} onChange={(e) => setPrefs({ ...prefs, keywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
                <div>
                  <Label>Blocked terms</Label>
                  <Textarea value={prefs.blockedKeywords.join(", ")} onChange={(e) => setPrefs({ ...prefs, blockedKeywords: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Preferred locations</Label>
                  <Input value={prefs.preferredLocations.join(", ")} onChange={(e) => setPrefs({ ...prefs, preferredLocations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
                <div>
                  <Label>Excluded locations</Label>
                  <Input value={prefs.excludedLocations.join(", ")} onChange={(e) => setPrefs({ ...prefs, excludedLocations: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4 items-end">
                <div>
                  <Label>Minimum salary (AUD)</Label>
                  <Input type="number" value={prefs.minSalary ?? 0} onChange={(e) => setPrefs({ ...prefs, minSalary: Number(e.target.value || 0) })} />
                </div>
                <div>
                  <Label>Work types</Label>
                  <Input value={prefs.workTypes.join(", ")} onChange={(e) => setPrefs({ ...prefs, workTypes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label>Industries</Label>
                  <Input value={prefs.industries.join(", ")} onChange={(e) => setPrefs({ ...prefs, industries: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
                <div>
                  <Label>Seniority</Label>
                  <Input value={prefs.seniority.join(", ")} onChange={(e) => setPrefs({ ...prefs, seniority: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Switch checked={prefs.remoteOnly} onCheckedChange={(v) => setPrefs({ ...prefs, remoteOnly: v })} />
                <Label>Remote only</Label>
              </div>

              <Separator />
              <div className="space-y-3">
                <h3 className="text-sm font-medium flex items-center gap-2"><Sparkles className="w-4 h-4" /> Tuning weights</h3>
                <WeightsEditor prefs={prefs} setPrefs={setPrefs} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sources" className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Job sources" subtitle="Toggle which sources to search. Implement API keys in the adapters for production." icon={Settings} />
            </CardHeader>
            <CardContent className="space-y-3">
              {jobAdapters.map((a) => (
                <div key={a.name} className="flex items-center justify-between py-2 border-b last:border-b-0">
                  <div>
                    <div className="font-medium">{a.name}</div>
                    <div className="text-xs text-muted-foreground">Plug in the official API / RSS where available. Respect ToS.</div>
                  </div>
                  <Switch checked={a.enabled} onCheckedChange={(v) => (a.enabled = v)} />
                </div>
              ))}
              <div className="text-xs text-muted-foreground">Suggested AU feeds: SEEK, I Work For NSW, APSJobs, university careers, major consultancies, tech firms.</div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="saved" className="space-y-4">
          <Card>
            <CardHeader>
              <SectionHeader title="Saved roles" subtitle="Quick list of roles you marked for later." icon={Star} />
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-4">
              {saved.length === 0 ? (
                <p className="text-sm text-muted-foreground">No saved roles yet.</p>
              ) : (
                saved.map((job) => (
                  <JobCard key={`saved-${job.source}-${job.id}`} job={job} onFeedback={() => {}} onSave={() => {}} />
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <footer className="mt-10 text-xs text-muted-foreground">
        Built for a doctorate-trained organisational psychologist ready for a next chapter — consulting, people analytics, OD leadership, behavioural insights, academia, and beyond.
      </footer>
    </div>
  );
}

// Imperative Feedback bridge
function FeedbackFormWrapper(props: any) {
  return (
    <FeedbackForm
      {...props}
      onSubmit={(liked: boolean, notes: string, tags: string[]) => {
        if (typeof window !== "undefined") {
          (window as any).__lastFeedback = { liked, notes, tags };
        }
        props.onSubmit?.(liked, notes, tags);
      }}
    />
  );
}
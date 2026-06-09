import { useEffect, useState } from "react";
import { Check, Copy, Globe, Loader2, Mail, Send, Sparkles, X } from "lucide-react";

import type { ContactAttempt, ContactChannel, ListingDetail } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { ToneBadge } from "./ToneBadge";
import { api } from "../lib/api";

type ListingApplySectionProps = {
  listing: ListingDetail;
  onContacted: () => void;
};

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IGNORED_EMAIL_PATTERN = /no-?reply|example\.|sentry|@(?:w3|schema)\./i;

function findContactEmail(listing: ListingDetail): string | null {
  const haystack = `${listing.description ?? ""}\n${JSON.stringify(listing.rawPayload ?? {})}`;
  const matches = haystack.match(EMAIL_PATTERN) ?? [];
  const candidate = matches.find((email) => !IGNORED_EMAIL_PATTERN.test(email));
  return candidate ?? null;
}

function formatAttemptTimestamp(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

export function ListingApplySection({ listing, onContacted }: ListingApplySectionProps) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [channel, setChannel] = useState<ContactChannel>("EMAIL");
  const [attempts, setAttempts] = useState<ContactAttempt[]>([]);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assistRunning, setAssistRunning] = useState(false);
  const [assistMessage, setAssistMessage] = useState<string | null>(null);

  const contactEmail = findContactEmail(listing);
  const hasDraft = subject.trim().length > 0 || body.trim().length > 0;

  useEffect(() => {
    setSubject("");
    setBody("");
    setChannel("EMAIL");
    setError(null);
    setCopied(false);
    setAttempts([]);
    setAssistRunning(false);
    setAssistMessage(null);

    let cancelled = false;

    api
      .listContactAttempts(listing.id)
      .then((history) => {
        if (!cancelled) {
          setAttempts(history);
        }
      })
      .catch(() => {
        // History is non-critical; the section still works without it.
      });

    return () => {
      cancelled = true;
    };
  }, [listing.id]);

  async function generateDraft() {
    setGenerating(true);
    setError(null);

    try {
      const draft = await api.generateContactMessage(listing.id);
      setSubject(draft.subject);
      setBody(draft.body);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Contact message generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(subject ? `${subject}\n\n${body}` : body);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setError("Clipboard copy failed in this browser context.");
    }
  }

  function openMailto() {
    if (!contactEmail) {
      return;
    }

    const params = new URLSearchParams({
      subject,
      body
    });
    window.location.href = `mailto:${contactEmail}?${params.toString().replace(/\+/g, "%20")}`;
  }

  async function openFormAssist() {
    setError(null);
    setAssistMessage(null);

    try {
      const summary = await api.startApplyAssist(listing.id, {
        subject: subject.trim() || null,
        body
      });
      setAssistRunning(summary.status === "running");
      setAssistMessage(summary.message);
    } catch (assistError) {
      setError(assistError instanceof Error ? assistError.message : "Form assist failed to start");
    }
  }

  async function closeFormAssist() {
    try {
      await api.closeApplyAssist(listing.id);
    } catch {
      // Closing is best-effort; the window may already be gone.
    } finally {
      setAssistRunning(false);
      setAssistMessage(null);
    }
  }

  async function markSent() {
    setSaving(true);
    setError(null);

    try {
      const attempt = await api.createContactAttempt(listing.id, {
        channel,
        status: "SENT",
        messageSubject: subject.trim() || null,
        messageBody: body.trim() || null,
        errorMessage: null
      });
      setAttempts((current) => [attempt, ...current]);
      onContacted();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Saving the contact attempt failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium">Apply</h3>
        <div className="flex flex-wrap gap-2">
          {attempts.length > 0 ? <ToneBadge tone="success">{attempts.length} attempt{attempts.length > 1 ? "s" : ""}</ToneBadge> : null}
          {contactEmail ? <ToneBadge tone="info">{contactEmail}</ToneBadge> : null}
        </div>
      </div>

      <div className="mt-3 space-y-3">
        <Button disabled={generating} onClick={() => void generateDraft()} size="sm" variant="outline">
          {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {hasDraft ? "Regenerate application draft" : "Generate application draft"}
        </Button>

        {hasDraft ? (
          <div className="space-y-2">
            <Input onChange={(event) => setSubject(event.target.value)} placeholder="Subject" value={subject} />
            <Textarea
              className="min-h-48 text-sm leading-relaxed"
              onChange={(event) => setBody(event.target.value)}
              placeholder="Application message"
              value={body}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void copyDraft()} size="sm" variant="secondary">
                {copied ? <Check /> : <Copy />}
                {copied ? "Copied" : "Copy"}
              </Button>
              {contactEmail ? (
                <Button onClick={openMailto} size="sm" variant="secondary">
                  <Mail />
                  Open email
                </Button>
              ) : null}
              <Select onValueChange={(value) => setChannel(value as ContactChannel)} value={channel}>
                <SelectTrigger className="h-8 w-36" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EMAIL">Email</SelectItem>
                  <SelectItem value="PORTAL_FORM">Portal form</SelectItem>
                  <SelectItem value="PHONE">Phone</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
              <Button disabled={saving} onClick={() => void markSent()} size="sm">
                {saving ? <Loader2 className="animate-spin" /> : <Send />}
                Mark as sent
              </Button>
              {assistRunning ? (
                <Button onClick={() => void closeFormAssist()} size="sm" variant="outline">
                  <X />
                  Close assist window
                </Button>
              ) : (
                <Button onClick={() => void openFormAssist()} size="sm" variant="outline">
                  <Globe />
                  Open form assist
                </Button>
              )}
            </div>
            {assistMessage ? <p className="text-sm text-muted-foreground">{assistMessage}</p> : null}
          </div>
        ) : null}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {attempts.length > 0 ? (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Contact history</h4>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {attempts.map((attempt) => (
                <li className="flex flex-wrap items-center gap-2" key={attempt.id}>
                  <ToneBadge tone={attempt.status === "FAILED" ? "danger" : "success"}>{attempt.status}</ToneBadge>
                  <span>{attempt.channel.replace(/_/g, " ").toLowerCase()}</span>
                  <span>· {formatAttemptTimestamp(attempt.timestamp)}</span>
                  {attempt.messageSubject ? <span className="truncate">· {attempt.messageSubject}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

import type { AppSettings } from "@flathunter/shared";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { FormField } from "./FormField";
import { SurfaceCard } from "./SurfaceCard";

type SettingsPanelProps = {
  settings: AppSettings | null;
  onChange: (next: AppSettings) => void;
  onSave: () => void;
};

export function SettingsPanel({ settings, onChange, onSave }: SettingsPanelProps) {
  if (!settings) {
    return (
      <SurfaceCard>
        <div className="grid min-h-32 place-items-center text-sm text-muted-foreground">Loading settings...</div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard subtitle="Runtime, scoring, and search configuration for the worker." title="Settings">
      <div className="grid gap-4 md:grid-cols-2">
        <FormField htmlFor="settings-max-rent" label="Max warm rent">
          <Input
            id="settings-max-rent"
            min={0}
            onChange={(event) =>
              onChange({ ...settings, scoring: { ...settings.scoring, maxWarmRent: Number(event.target.value) } })
            }
            type="number"
            value={settings.scoring.maxWarmRent}
          />
        </FormField>
        <FormField htmlFor="settings-min-size" label="Minimum size">
          <Input
            id="settings-min-size"
            min={0}
            onChange={(event) =>
              onChange({ ...settings, scoring: { ...settings.scoring, minimumSizeSqm: Number(event.target.value) } })
            }
            type="number"
            value={settings.scoring.minimumSizeSqm}
          />
        </FormField>
        <FormField htmlFor="settings-min-rooms" label="Minimum rooms">
          <Input
            id="settings-min-rooms"
            min={0}
            onChange={(event) =>
              onChange({ ...settings, scoring: { ...settings.scoring, minimumRooms: Number(event.target.value) } })
            }
            step={0.5}
            type="number"
            value={settings.scoring.minimumRooms}
          />
        </FormField>
        <FormField htmlFor="settings-classifier-model" label="Classifier model">
          <Input
            id="settings-classifier-model"
            onChange={(event) =>
              onChange({ ...settings, runtime: { ...settings.runtime, llmClassifierModel: event.target.value } })
            }
            value={settings.runtime.llmClassifierModel}
          />
        </FormField>
        <FormField htmlFor="settings-analyst-model" label="English analyst model">
          <Input
            id="settings-analyst-model"
            onChange={(event) =>
              onChange({ ...settings, runtime: { ...settings.runtime, llmAnalystModel: event.target.value } })
            }
            value={settings.runtime.llmAnalystModel}
          />
        </FormField>
        <FormField label="Use fixtures">
          <Select
            onValueChange={(value) =>
              onChange({ ...settings, runtime: { ...settings.runtime, scrapeWithFixtures: value === "true" } })
            }
            value={settings.runtime.scrapeWithFixtures ? "true" : "false"}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Yes</SelectItem>
              <SelectItem value="false">No</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField className="md:col-span-2" htmlFor="settings-search-url" label="Immowelt search URL">
          <Input
            id="settings-search-url"
            onChange={(event) =>
              onChange({ ...settings, search: { ...settings.search, immoweltSearchUrl: event.target.value } })
            }
            value={settings.search.immoweltSearchUrl}
          />
        </FormField>
        <FormField className="md:col-span-2" htmlFor="settings-semantic-notes" label="Semantic notes">
          <Textarea
            id="settings-semantic-notes"
            onChange={(event) =>
              onChange({ ...settings, semanticRules: { ...settings.semanticRules, notes: event.target.value } })
            }
            rows={4}
            value={settings.semanticRules.notes}
          />
        </FormField>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={() => onSave()}>Save settings</Button>
      </div>
    </SurfaceCard>
  );
}

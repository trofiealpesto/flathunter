import { Box, Button, Heading, Text } from "gestalt";

import type { AppSettings } from "@flathunter/shared";

type SettingsPanelProps = {
  settings: AppSettings | null;
  onChange: (next: AppSettings) => void;
  onSave: () => void;
};

export function SettingsPanel({ settings, onChange, onSave }: SettingsPanelProps) {
  if (!settings) {
    return (
      <div className="surface-card surface-card--settings">
        <Box color="default" rounding={6} padding={5}>
          <div className="centered-block">Loading settings...</div>
        </Box>
      </div>
    );
  }

  return (
    <div className="surface-card surface-card--settings">
      <Box color="default" rounding={6} padding={5}>
        <div className="panel-header">
          <Heading size="300" accessibilityLevel={2}>
            Settings
          </Heading>
          <Text size="100" color="subtle">
            Runtime, scoring, and search configuration for the worker.
          </Text>
        </div>

        <div className="panel-scroll">
          <div className="field-grid field-grid--settings">
            <label className="field">
              <span>Max warm rent</span>
              <input
                type="number"
                value={settings.scoring.maxWarmRent}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    scoring: {
                      ...settings.scoring,
                      maxWarmRent: Number(event.target.value)
                    }
                  })
                }
              />
            </label>
            <label className="field">
              <span>Minimum size</span>
              <input
                type="number"
                value={settings.scoring.minimumSizeSqm}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    scoring: {
                      ...settings.scoring,
                      minimumSizeSqm: Number(event.target.value)
                    }
                  })
                }
              />
            </label>
            <label className="field">
              <span>Minimum rooms</span>
              <input
                type="number"
                value={settings.scoring.minimumRooms}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    scoring: {
                      ...settings.scoring,
                      minimumRooms: Number(event.target.value)
                    }
                  })
                }
              />
            </label>
            <label className="field">
              <span>Classifier model</span>
              <input
                value={settings.runtime.llmClassifierModel}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    runtime: {
                      ...settings.runtime,
                      llmClassifierModel: event.target.value
                    }
                  })
                }
              />
            </label>
            <label className="field">
              <span>English analyst model</span>
              <input
                value={settings.runtime.llmAnalystModel}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    runtime: {
                      ...settings.runtime,
                      llmAnalystModel: event.target.value
                    }
                  })
                }
              />
            </label>
            <label className="field">
              <span>Use fixtures</span>
              <select
                value={settings.runtime.scrapeWithFixtures ? "true" : "false"}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    runtime: {
                      ...settings.runtime,
                      scrapeWithFixtures: event.target.value === "true"
                    }
                  })
                }
              >
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </label>
            <label className="field">
              <span>Semantic classifier</span>
              <select
                value={settings.runtime.enableSemanticClassifier ? "true" : "false"}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    runtime: {
                      ...settings.runtime,
                      enableSemanticClassifier: event.target.value === "true"
                    }
                  })
                }
              >
                <option value="true">Enabled</option>
                <option value="false">Disabled</option>
              </select>
            </label>
            <label className="field field-span">
              <span>Immowelt search URL</span>
              <input
                value={settings.search.immoweltSearchUrl}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    search: {
                      ...settings.search,
                      immoweltSearchUrl: event.target.value
                    }
                  })
                }
              />
            </label>
            <label className="field field-span">
              <span>Semantic notes</span>
              <textarea
                rows={4}
                value={settings.semanticRules.notes}
                onChange={(event) =>
                  onChange({
                    ...settings,
                    semanticRules: {
                      ...settings.semanticRules,
                      notes: event.target.value
                    }
                  })
                }
              />
            </label>
          </div>
        </div>

        <div className="panel-actions">
          <Button color="dark" text="Save settings" onClick={() => onSave()} />
        </div>
      </Box>
    </div>
  );
}

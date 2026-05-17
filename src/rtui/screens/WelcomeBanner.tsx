import { Box, Text } from "ink";

const WELCOME_BANNER_ART = "RelayOS — chat shell";

const TIPS: readonly string[] = [
  "Type / to open the command palette",
  "Use ↑/↓ to navigate, Return to select, Esc to dismiss",
  "Type /help for the full command list",
];

export interface WelcomeBannerProps {
  recent: readonly string[];
}

export function WelcomeBanner({ recent }: WelcomeBannerProps) {
  const top3 = recent.slice(0, 3);
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold>{WELCOME_BANNER_ART}</Text>
      <Box flexDirection="column" marginTop={1}>
        <Text bold>Recent activity</Text>
        {top3.length === 0 ? (
          <Text dimColor>  (none)</Text>
        ) : (
          top3.map((line, i) => <Text key={i}>{`  ${line}`}</Text>)
        )}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {TIPS.map((tip, i) => (
          <Text key={i} dimColor>{`  ${tip}`}</Text>
        ))}
      </Box>
    </Box>
  );
}

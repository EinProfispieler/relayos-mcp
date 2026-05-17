import { Box, Text } from "ink";
import { colors } from "../theme/colors.js";

interface Props {
  spinner: string | null;
  streaming: string | null;
  progress: number | null;
}

export function LiveRegion({ spinner, streaming, progress }: Props) {
  if (spinner === null && streaming === null && progress === null) {
    return null;
  }
  return (
    <Box>
      {spinner !== null && <Text color={colors.thinking}>{spinner} </Text>}
      {streaming !== null && <Text color={colors.dim}>{streaming}</Text>}
      {progress !== null && <Text color={colors.dim}>{` ${Math.round(progress * 100)}%`}</Text>}
    </Box>
  );
}

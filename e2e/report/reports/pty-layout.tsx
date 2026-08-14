// A deliberately tiny public-report fixture for the PTY geometry witness. Its
// content is static so terminal width, CJK cells, wrapping, and padding can be
// compared byte-for-byte without turning a full overview into a data oracle.
import { Col, Section, Text, defineReport } from "niceeval/report";

const WRAPPED_CJK_LINE = "固定宽度的中文布局见证：这一行必须在窄框中折行一次，并保留尾部填充。";

export default defineReport({
  title: { en: "PTY layout witness", "zh-CN": "PTY 布局见证" },
  pages: [
    {
      id: "overview",
      title: { en: "Overview", "zh-CN": "总览" },
      render: () => (
        <Col>
          <Section title={{ en: "PTY geometry", "zh-CN": "终端几何" }} meta="fixed 60 columns">
            <Text>{WRAPPED_CJK_LINE}</Text>
          </Section>
        </Col>
      ),
    },
  ],
});

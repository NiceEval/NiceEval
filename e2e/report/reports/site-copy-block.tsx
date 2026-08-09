import { CopyBlock, defineComponent } from "niceeval/report";

export const FIXTURE_COPY_TEXT = "niceeval report fixture copy text";

const title = "Fixture copy block";

export const SiteCopyBlock = defineComponent(() => {
  return (
    <CopyBlock
      title={{ en: title, "zh-CN": title }}
      text={FIXTURE_COPY_TEXT}
    />
  );
});

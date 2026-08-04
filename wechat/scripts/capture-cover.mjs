import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";

const COVER_OUTPUT = { width: 1187, height: 507 };
const COVER_VIEWPORT = { width: 1600, height: 900 };

function computeCoverCapturePlan({
  viewport,
  wrapRect,
  mastheadRect,
  top3Rect,
  outputSize = COVER_OUTPUT,
}) {
  const aspectRatio = outputSize.width / outputSize.height;
  const sourceCropHeight = Math.round(top3Rect.y - mastheadRect.y);
  const sourceCropWidth = Math.round(sourceCropHeight * aspectRatio);
  const wrapCenterX = wrapRect.x + wrapRect.width / 2;
  const sourceCropX = Math.round(wrapCenterX - sourceCropWidth / 2);
  const sourceCropY = Math.round(mastheadRect.y);

  return {
    aspectRatio,
    viewport,
    outputSize,
    startAnchor: "masthead-double-rule",
    endAnchor: "before-top3",
    sourceCrop: {
      x: sourceCropX,
      y: sourceCropY,
      width: sourceCropWidth,
      height: sourceCropHeight,
    },
  };
}

async function measureCoverAnchors(page) {
  return page.evaluate(() => {
    const rectFor = (selector) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing cover selector: ${selector}`);
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    return {
      wrapRect: rectFor(".wrap"),
      mastheadRect: rectFor(".masthead"),
      top3Rect: rectFor(".top3"),
    };
  });
}

function resizeCover(outputPath) {
  const result = spawnSync(
    "sips",
    ["-z", String(COVER_OUTPUT.height), String(COVER_OUTPUT.width), outputPath],
    { encoding: "utf8" }
  );

  if (result.status !== 0 || !existsSync(outputPath)) {
    throw new Error(
      ["Failed to resize WeChat cover with macOS sips.", result.stderr, result.stdout]
        .filter(Boolean)
        .join("\n")
    );
  }
}

async function captureWechatCover({ sourceUrl, outputPath }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: COVER_VIEWPORT });

  try {
    await page.goto(sourceUrl, { waitUntil: "networkidle" });
    let anchors = await measureCoverAnchors(page);
    let plan = computeCoverCapturePlan({ viewport: COVER_VIEWPORT, ...anchors });
    const requiredViewportWidth = Math.max(
      COVER_VIEWPORT.width,
      plan.sourceCrop.width + 48
    );

    if (requiredViewportWidth !== COVER_VIEWPORT.width) {
      const viewport = { ...COVER_VIEWPORT, width: requiredViewportWidth };
      await page.setViewportSize(viewport);
      anchors = await measureCoverAnchors(page);
      plan = computeCoverCapturePlan({ viewport, ...anchors });
    }

    if (plan.sourceCrop.x < 0) {
      throw new Error("Cover crop exceeds the page width after viewport adjustment.");
    }

    await page.screenshot({ path: outputPath, clip: plan.sourceCrop });
    resizeCover(outputPath);
    return plan;
  } finally {
    await browser.close();
  }
}

export { captureWechatCover, computeCoverCapturePlan };

import { readJsonFile, writeJsonFile } from '../lib/json.js';
import { getStatePath } from '../lib/paths.js';

const REVIEW_STATE_PATH = getStatePath('data/system/review-state.json');
const REVIEW_TTL_MS = 24 * 60 * 60 * 1000;

type ReviewVia = 'show' | 'assess';

interface ReviewReceipt {
  reviewedAt: string;
  via: ReviewVia;
}

interface ReviewState {
  reviews: Record<string, ReviewReceipt>;
}

export async function recordItemReview(id: string, via: ReviewVia): Promise<void> {
  const state = await loadReviewState();
  state.reviews[id] = {
    reviewedAt: new Date().toISOString(),
    via
  };
  await writeJsonFile(REVIEW_STATE_PATH, state);
}

export async function hasRecentReview(id: string, now = Date.now()): Promise<boolean> {
  const receipt = await getReviewReceipt(id);
  if (!receipt) {
    return false;
  }

  const reviewedAtMs = Date.parse(receipt.reviewedAt);
  if (Number.isNaN(reviewedAtMs)) {
    return false;
  }

  return now - reviewedAtMs <= REVIEW_TTL_MS;
}

export async function assertRecentReview(id: string): Promise<void> {
  if (await hasRecentReview(id)) {
    return;
  }

  throw new Error(
    `Review required before install for ${id}. Run \`plugscout show --id ${id}\` or \`plugscout assess --id ${id}\`, then retry. Use --override-review only if you intentionally want to bypass this safeguard.`
  );
}

export function getReviewStatePath(): string {
  return REVIEW_STATE_PATH;
}

async function getReviewReceipt(id: string): Promise<ReviewReceipt | null> {
  const state = await loadReviewState();
  return state.reviews[id] ?? null;
}

async function loadReviewState(): Promise<ReviewState> {
  try {
    const raw = await readJsonFile<unknown>(REVIEW_STATE_PATH);
    if (!raw || typeof raw !== 'object') {
      return { reviews: {} };
    }

    const reviews = (raw as { reviews?: unknown }).reviews;
    if (!reviews || typeof reviews !== 'object') {
      return { reviews: {} };
    }

    const normalized: Record<string, ReviewReceipt> = {};
    Object.entries(reviews as Record<string, unknown>).forEach(([id, value]) => {
      if (!value || typeof value !== 'object') {
        return;
      }

      const reviewedAt = typeof (value as { reviewedAt?: unknown }).reviewedAt === 'string'
        ? (value as { reviewedAt: string }).reviewedAt
        : null;
      const via = (value as { via?: unknown }).via;
      if (!reviewedAt || (via !== 'show' && via !== 'assess')) {
        return;
      }

      normalized[id] = { reviewedAt, via };
    });

    return { reviews: normalized };
  } catch (error) {
    const maybeFsError = error as NodeJS.ErrnoException;
    if (maybeFsError.code === 'ENOENT') {
      return { reviews: {} };
    }
    throw error;
  }
}

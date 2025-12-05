import Document from '../models/Document.js';
import { getSponsoredDocuments } from './adManager.js';
import { getUserPreferences } from './userPreferences.js';
import logger from './logger.js';

export async function generateFeed({
  userId,
  cursor,
  limit = 20,
  category = null,
  sort = 'newest',
  includeAds = true
}) {
  try {
    const baseQuery = {
      status: 'processed',
      visibility: 'public'
    };

    if (category) {
      baseQuery.category = category;
    }

    const totalDocs = await Document.countDocuments(baseQuery);

    const fetchQuery = { ...baseQuery };

    if (cursor) {
      const cursorDoc = await Document.findById(cursor).select('createdAt');
      if (cursorDoc) {
        fetchQuery.createdAt = { $lt: cursorDoc.createdAt };
      }
    }

    let sortOptions = {};
    switch (sort) {
      case 'popular':
        sortOptions = { viewsCount: -1, createdAt: -1 };
        break;
      case 'relevant':
        sortOptions = await getRelevanceSort(userId);
        break;
      case 'newest':
      default:
        sortOptions = { createdAt: -1 };
    }

    const documents = await Document.find(fetchQuery)
      .select('-metadata -embeddingsId')
      .populate('userId', 'name')
      .sort(sortOptions)
      .limit(limit + 10);

    let feedDocuments = [...documents];

    if (includeAds && feedDocuments.length > 0) {
      feedDocuments = await injectAds(feedDocuments, userId);
    }

    feedDocuments = feedDocuments.slice(0, limit);

    const nextCursor = feedDocuments.length > 0 
      ? feedDocuments[feedDocuments.length - 1]._id 
      : null;

    const userPrefs = await getUserPreferences(userId);

    return {
      documents: feedDocuments,
      pagination: {
        hasMore: nextCursor !== null && feedDocuments.length >= limit,
        nextCursor,
        limit,
        totalReturned: feedDocuments.length,
        total: totalDocs
      },
      metadata: {
        sort,
        category,
        personalized: userPrefs !== null
      }
    };

  } catch (error) {
    logger.error('Error generating feed:', error);
    throw error;
  }
}

async function getRelevanceSort(userId) {
  // Placeholder for personalized relevance sorting
  // This would use user embeddings, browsing history, etc.
  // For now, fall back to popularity
  return { viewsCount: -1, createdAt: -1 };
}

async function injectAds(documents, userId) {
  try {
    const adFrequency = 5; // Inject ad every 5 documents
    const sponsoredDocs = await getSponsoredDocuments(10); // Get more than needed
    
    if (sponsoredDocs.length === 0) {
      return documents;
    }

    const result = [];
    let adIndex = 0;

    for (let i = 0; i < documents.length; i++) {
      result.push(documents[i]);

      if ((i + 1) % adFrequency === 0 && i > 0 && i < documents.length - 2) {
        if (adIndex < sponsoredDocs.length) {
          const adDoc = {
            ...sponsoredDocs[adIndex].toObject(),
            isSponsored: true,
            adId: `ad_${Date.now()}_${adIndex}`
          };
          result.push(adDoc);
          adIndex++;
        }
      }
    }

    return result;
  } catch (error) {
    logger.error('Error injecting ads:', error);
    return documents;
  }
}

export async function generatePersonalizedFeed(userId, limit = 20) {
  const userPrefs = await getUserPreferences(userId);
  
  if (!userPrefs || !userPrefs.preferredCategories) {
    return generateFeed({ userId, limit, sort: 'popular' });
  }

  const preferredDocs = await Document.find({
    status: 'processed',
    visibility: 'public',
    category: { $in: userPrefs.preferredCategories }
  })
  .select('-metadata -embeddingsId')
  .populate('userId', 'name')
  .sort({ viewsCount: -1, createdAt: -1 })
  .limit(limit);

  if (preferredDocs.length < limit) {
    const remaining = limit - preferredDocs.length;
    const trendingDocs = await Document.find({
      status: 'processed',
      visibility: 'public',
      category: { $nin: userPrefs.preferredCategories }
    })
    .select('-metadata -embeddingsId')
    .populate('userId', 'name')
    .sort({ viewsCount: -1, createdAt: -1 })
    .limit(remaining);

    preferredDocs.push(...trendingDocs);
  }

  const feedDocuments = await injectAds(preferredDocs, userId);

  return {
    documents: feedDocuments,
    pagination: {
      hasMore: false, 
      limit
    },
    metadata: {
      sort: 'personalized',
      personalized: true
    }
  };
}
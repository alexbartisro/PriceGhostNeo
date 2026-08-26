import { Router, Response } from 'express';
import { AuthRequest, authMiddleware } from '../middleware/auth';
import { productQueries, priceHistoryQueries, stockStatusHistoryQueries, userQueries, notificationHistoryQueries, NotificationType } from '../models';
import { scrapeProductWithVoting, ExtractionMethod } from '../services/scraper';
import { sendNotifications, NotificationPayload } from '../services/notifications';

const router = Router();

// All routes require authentication
router.use(authMiddleware);

// Get price history for a product
router.get('/:productId/prices', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = parseInt(req.params.productId, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    // Verify product belongs to user
    const product = await productQueries.findById(productId, userId);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Get optional days filter from query
    const days = req.query.days ? parseInt(req.query.days as string, 10) : undefined;

    const priceHistory = await priceHistoryQueries.findByProductId(
      productId,
      days
    );

    res.json({
      product,
      prices: priceHistory,
    });
  } catch (error) {
    console.error('Error fetching price history:', error);
    res.status(500).json({ error: 'Failed to fetch price history' });
  }
});

// Force immediate price refresh
router.post('/:productId/refresh', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = parseInt(req.params.productId, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    // Verify product belongs to user
    const product = await productQueries.findById(productId, userId);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Get product settings for AI skip flags
    const preferredMethod = await productQueries.getPreferredExtractionMethod(productId);
    const anchorPrice = await productQueries.getAnchorPrice(productId);
    const skipAiVerification = await productQueries.isAiVerificationDisabled(productId);
    const skipAiExtraction = await productQueries.isAiExtractionDisabled(productId);

    // Scrape product data with proper settings (same as scheduler)
    const scrapedData = await scrapeProductWithVoting(
      product.url,
      userId,
      preferredMethod as ExtractionMethod | undefined,
      anchorPrice || undefined,
      skipAiVerification,
      skipAiExtraction,
      product.currency_override || undefined
    );

    // Update stock status and record change if different
    if (scrapedData.stockStatus !== product.stock_status) {
      await productQueries.updateStockStatus(productId, scrapedData.stockStatus);
      await stockStatusHistoryQueries.recordChange(productId, scrapedData.stockStatus);
    }

    // Record new price if available
    let newPrice = null;
    if (scrapedData.price) {
      newPrice = await priceHistoryQueries.create(
        productId,
        scrapedData.price.price,
        scrapedData.price.currency,
        scrapedData.aiStatus
      );
    }

    // Check for a newly-detected (or changed) discount/voucher code
    const hasNewDiscount =
      (scrapedData.discountCode || scrapedData.discountText) &&
      (scrapedData.discountCode !== product.discount_code || scrapedData.discountText !== product.discount_text);

    if (hasNewDiscount) {
      try {
        const userSettings = await userQueries.getNotificationSettings(userId);
        if (userSettings) {
          const payload: NotificationPayload = {
            productName: product.name || 'Unknown Product',
            productUrl: product.url,
            type: 'voucher_available',
            discountCode: scrapedData.discountCode,
            discountText: scrapedData.discountText,
          };
          const result = await sendNotifications(userSettings, payload);

          if (result.channelsNotified.length > 0) {
            await notificationHistoryQueries.create({
              user_id: userId,
              product_id: productId,
              notification_type: 'voucher_available' as NotificationType,
              channels_notified: result.channelsNotified,
              product_name: product.name || 'Unknown Product',
              product_url: product.url,
            });
          }
        }
      } catch (notifyError) {
        console.error(`Failed to send voucher notification for product ${productId}:`, notifyError);
      }
    }

    await productQueries.updateDiscountInfo(productId, scrapedData.discountCode, scrapedData.discountText);

    // Update last_checked timestamp and schedule next check
    await productQueries.updateLastChecked(productId, product.refresh_interval);

    res.json({
      message: scrapedData.stockStatus === 'out_of_stock'
        ? 'Product is currently out of stock'
        : 'Price refreshed successfully',
      price: newPrice,
      stockStatus: scrapedData.stockStatus,
      aiStatus: scrapedData.aiStatus,
    });
  } catch (error) {
    console.error('Error refreshing price:', error);
    res.status(500).json({ error: 'Failed to refresh price' });
  }
});

// Get stock status history for a product
router.get('/:productId/stock-history', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const productId = parseInt(req.params.productId, 10);

    if (isNaN(productId)) {
      res.status(400).json({ error: 'Invalid product ID' });
      return;
    }

    // Verify product belongs to user
    const product = await productQueries.findById(productId, userId);
    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Get optional days filter from query (default 30 days)
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 30;

    const stockHistory = await stockStatusHistoryQueries.getByProductId(productId, days);
    const stats = await stockStatusHistoryQueries.getStats(productId, days);

    res.json({
      history: stockHistory,
      stats,
    });
  } catch (error) {
    console.error('Error fetching stock status history:', error);
    res.status(500).json({ error: 'Failed to fetch stock status history' });
  }
});

export default router;

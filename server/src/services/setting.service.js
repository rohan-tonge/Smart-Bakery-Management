import Setting from "../models/setting.model.js";

const DEFAULT_PAYMENT_QR = {
  upiId: "bakeryowner@upi",
  payeeName: "Smart Bakery",
  qrImageUrl: "",
  qrData: "upi://pay?pa=bakeryowner@upi&pn=Smart%20Bakery",
  instructions:
    "Scan this UPI QR code using any UPI app (Google Pay, PhonePe, Paytm, BHIM). After paying, click 'I HAVE PAID' below.",
  isPlaceholder: true,
  placeholderNotice:
    "NOTE: This is a placeholder QR code until the owner configures the official UPI QR in the Owner/Manager dashboard.",
};

class SettingService {
  async getPaymentQr() {
    const doc = await Setting.findOne({ key: "PAYMENT_QR" }).lean();
    if (!doc) {
      return DEFAULT_PAYMENT_QR;
    }
    return {
      ...DEFAULT_PAYMENT_QR,
      ...doc.value,
      updatedAt: doc.updatedAt,
      updatedBy: doc.updatedBy,
    };
  }

  async updatePaymentQr(input, userId) {
    const upiId = input.upiId?.trim() || DEFAULT_PAYMENT_QR.upiId;
    const payeeName = input.payeeName?.trim() || DEFAULT_PAYMENT_QR.payeeName;
    const value = {
      upiId,
      payeeName,
      qrImageUrl: input.qrImageUrl ? input.qrImageUrl.trim() : "",
      qrData: `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&cu=INR`,
      instructions:
        input.instructions?.trim() || DEFAULT_PAYMENT_QR.instructions,
      isPlaceholder: Boolean(input.isPlaceholder),
      placeholderNotice: input.isPlaceholder
        ? DEFAULT_PAYMENT_QR.placeholderNotice
        : "",
    };

    const doc = await Setting.findOneAndUpdate(
      { key: "PAYMENT_QR" },
      {
        $set: {
          value,
          description: "Bakery owner UPI payment QR configuration",
          updatedBy: userId,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return doc.value;
  }
}

export const settingService = new SettingService();
export default settingService;

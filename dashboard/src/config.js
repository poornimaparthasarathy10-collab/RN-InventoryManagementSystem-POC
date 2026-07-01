const config = {
  API_BASE_URL: "https://3y5lxca18k.execute-api.ap-south-1.amazonaws.com/prod",
  endpoints: {
    getProducts:       "/getProducts",
    placeOrder:        "/placeOrder",
    getDailyOrders:    "/getDailyOrders",
    generateBill:      "/generateBill",
    lowStockAlert:     "/lowStockAlert",
    getInventory:      "/getInventory",
    addStock:          "/addStock",
    updateOrderStatus: "/updateOrderStatus",
    scanBill:          "/scanBill"
  }
};

export default config;
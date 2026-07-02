const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const dynamoClient = new DynamoDBClient({ region: "ap-south-1" });
const snsClient = new SNSClient({ region: "ap-south-1" });

const SNS_TOPIC_ARN = "arn:aws:sns:ap-south-1:016647419847:RN_LowStockAlert";

exports.handler = async (event) => {
  try {
    // Scan all inventory
    const response = await dynamoClient.send(new ScanCommand({
      TableName: "RN_Inventory"
    }));

    const inventory = response.Items.map(item => unmarshall(item));

    // Find low stock items
    const lowStockItems = inventory.filter(
      item => item.CurrentStock <= item.MinimumStock
    );

    if (lowStockItems.length === 0) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: "All products are sufficiently stocked!",
          checkedItems: inventory.length
        })
      };
    }

    // Build alert message
    let alertMessage = "🚨 R.N. AGENCIES — LOW STOCK ALERT 🚨\n\n";
    alertMessage += `Date: ${new Date().toISOString().split('T')[0]}\n\n`;
    alertMessage += "The following products need immediate restocking:\n\n";

    lowStockItems.forEach(item => {
      alertMessage += `⚠️ Product: ${item.ProductName}\n`;
      alertMessage += `   Product ID: ${item.ProductID}\n`;
      alertMessage += `   Current Stock: ${item.CurrentStock}\n`;
      alertMessage += `   Minimum Stock: ${item.MinimumStock}\n`;
      alertMessage += `   Action Required: Reorder immediately!\n\n`;
    });

    alertMessage += "Please arrange restocking at the earliest.\n";
    alertMessage += "R.N. Agencies Distribution System";

    // Send SNS alert
    await snsClient.send(new PublishCommand({
      TopicArn: SNS_TOPIC_ARN,
      Subject: "🚨 Low Stock Alert — R.N. Agencies",
      Message: alertMessage
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Low stock alert sent successfully!",
        lowStockCount: lowStockItems.length,
        lowStockItems: lowStockItems.map(item => ({
          ProductID: item.ProductID,
          ProductName: item.ProductName,
          CurrentStock: item.CurrentStock,
          MinimumStock: item.MinimumStock
        }))
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error checking stock",
        error: error.message
      })
    };
  }
};
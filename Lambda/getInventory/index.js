const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "ap-south-1" });

exports.handler = async (event) => {
  try {
    const response = await client.send(new ScanCommand({
      TableName: "RN_Inventory"
    }));

    const inventory = response.Items.map(item => unmarshall(item));

    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: JSON.stringify({
        message: "Inventory fetched!",
        count: inventory.length,
        inventory: inventory
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ message: "Error", error: error.message })
    };
  }
};
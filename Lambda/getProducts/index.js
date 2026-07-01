const { DynamoDBClient, ScanCommand } = require("@aws-sdk/client-dynamodb");
const { unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "ap-south-1" });

exports.handler = async (event) => {
  try {
    // Get all products from RN_Products table
    const command = new ScanCommand({
      TableName: "RN_Products"
    });

    const response = await client.send(command);
    
    // Convert DynamoDB format to normal JSON
    const products = response.Items.map(item => unmarshall(item));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Products fetched successfully!",
        count: products.length,
        products: products
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error fetching products",
        error: error.message
      })
    };
  }
};
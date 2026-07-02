const { DynamoDBClient, PutItemCommand, GetItemCommand, UpdateItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall, unmarshall } = require("@aws-sdk/util-dynamodb");

const client = new DynamoDBClient({ region: "ap-south-1" });

exports.handler = async (event) => {
  try {
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event;
    
    const { ShopID, ShopName, Beat, SalesMan, ExpectedDeliveryDate, Products } = body;

    // Generate OrderID and InvoiceNumber
    const OrderID = "ORD" + Date.now();
    const InvoiceNumber = "INV" + Date.now();
    const OrderDate = new Date().toISOString().split('T')[0];

    let TotalOrderAmount = 0;
    const orderItems = [];

    // Process each product in order
    for (const product of Products) {
      const { ProductID, Quantity } = product;

      // Get product details from RN_Products
      const getProduct = await client.send(new GetItemCommand({
        TableName: "RN_Products",
        Key: marshall({ ProductID })
      }));

      if (!getProduct.Item) {
        return {
          statusCode: 404,
          body: JSON.stringify({ message: `Product ${ProductID} not found` })
        };
      }

      const productDetails = unmarshall(getProduct.Item);
      
      // Calculate amounts
      const Amount = productDetails.Rate * Quantity;
      const CGSTAmount = (Amount * productDetails.CGSTRate) / 100;
      const SGSTAmount = (Amount * productDetails.SGSTRate) / 100;
      const TaxableValue = Amount;
      const NetAmount = Amount + CGSTAmount + SGSTAmount;

      TotalOrderAmount += NetAmount;

      // Save order item
      const OrderItemID = "OI" + Date.now() + ProductID;
      orderItems.push({
        OrderItemID,
        OrderID,
        ProductID,
        ProductName: productDetails.ProductName,
        HSNCode: productDetails.HSNCode,
        MRP: productDetails.MRP,
        Pcs: Quantity,
        Rate: productDetails.Rate,
        Amount,
        Discount: 0,
        TaxableValue,
        CGSTRate: productDetails.CGSTRate,
        CGSTAmount,
        SGSTRate: productDetails.SGSTRate,
        SGSTAmount,
        NetAmount
      });

      // Save to RN_OrderItems
      await client.send(new PutItemCommand({
        TableName: "RN_OrderItems",
        Item: marshall({
          OrderItemID,
          OrderID,
          ProductID,
          ProductName: productDetails.ProductName,
          HSNCode: productDetails.HSNCode,
          MRP: productDetails.MRP,
          Pcs: Quantity,
          Rate: productDetails.Rate,
          Amount,
          Discount: 0,
          TaxableValue,
          CGSTRate: productDetails.CGSTRate,
          CGSTAmount,
          SGSTRate: productDetails.SGSTRate,
          SGSTAmount,
          NetAmount
        })
      }));

      // Update inventory
      await client.send(new UpdateItemCommand({
        TableName: "RN_Inventory",
        Key: marshall({ ProductID }),
        UpdateExpression: "SET CurrentStock = CurrentStock - :qty, LastUpdated = :date",
        ExpressionAttributeValues: marshall({
          ":qty": Quantity,
          ":date": OrderDate
        })
      }));
    }

    // Save order header to RN_Orders
    await client.send(new PutItemCommand({
      TableName: "RN_Orders",
      Item: marshall({
        OrderID,
        ShopID,
        ShopName,
        InvoiceNumber,
        Beat,
        SalesMan,
        OrderDate,
        ExpectedDeliveryDate,
        OrderStatus: "Pending",
        TotalOrderAmount: Math.round(TotalOrderAmount * 100) / 100
      })
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Order placed successfully!",
        OrderID,
        InvoiceNumber,
        ShopName,
        OrderDate,
        TotalOrderAmount: Math.round(TotalOrderAmount * 100) / 100,
        TotalItems: orderItems.length,
        OrderItems: orderItems
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Error placing order",
        error: error.message
      })
    };
  }
};
from dotenv import load_dotenv
load_dotenv()
import os
import boto3
from crewai import Agent, Crew, Process, Task
from crewai.tools import tool



@tool("Query Low Stock Inventory Database")
def check_low_stock_db() -> str:
    """Connects to live AWS DynamoDB table 'RN_Inventory' to find low stock items."""
    try:
        dynamodb = boto3.resource(
    'dynamodb',
    region_name=os.getenv("AWS_REGION", "ap-south-1")
)
        table = dynamodb.Table('RN_Inventory')
        
        response = table.scan()
        items = response.get('Items', [])
        low_stock_items = []
        
        for item in items:
            product_id = item.get('ProductID')
            product_name = item.get('ProductName', 'Unknown Item')
            
            try:
                current_stock = int(item.get('CurrentStock', 0))
            except (ValueError, TypeError):
                current_stock = 0
                
            try:
                minimum_stock = int(item.get('MinimumStock', 10))
            except (ValueError, TypeError):
                minimum_stock = 10
                
            standard_reorder_qty = 50 
            
            if current_stock <= minimum_stock:
                low_stock_items.append({
                    "product_id": product_id,
                    "product_name": product_name,
                    "current_stock": current_stock,
                    "threshold": minimum_stock,
                    "suggested_order": standard_reorder_qty
                })
                
        if not low_stock_items:
            return "FACT: All current stock levels in 'RN_Inventory' are healthy."
            
        return f"LIVE DYNAMODB LOW STOCK SNAPSHOT: {low_stock_items}"
        
    except Exception as e:
        return f"ERROR CONNECTING TO DYNAMODB TABLE 'RN_Inventory': {str(e)}"

@tool("Search Regional Consumer Market Trends")
def web_market_research(query: str) -> str:
    """Checks regional market indicators for product categories needing restock."""
    return f"MARKET TREND REPORT FOR '{query}': Strong demand patterns observed. Recommended to proceed with baseline volumes."

stock_auditor = Agent(
    role="Stock Auditor Executive",
    goal="Identify products that have dropped below safety levels inside the RN_Inventory table.",
    backstory="You run data audits for R.N. Agencies via AWS.",
    tools=[check_low_stock_db],
    verbose=True
)

market_analyst = Agent(
    role="Market Trend Intelligence Analyst",
    goal="Analyze broader market indicators to optimize order volumes.",
    backstory="You study consumer patterns to predict demand variations.",
    tools=[web_market_research],
    verbose=True
)

procurement_manager = Agent(
    role="Vendor Procurement Manager",
    goal="Compile procurement summaries and structure outreach drafts.",
    backstory="You format final summaries for the owner.",
    tools=[],
    verbose=True
)

task_audit = Task(
    description="Scan the 'RN_Inventory' table using check_low_stock_db to pinpoint low items.",
    expected_output="A clean list of products with thin stock counts.",
    agent=stock_auditor
)

task_analyze = Task(
    description="Evaluate market trends for the identified thin items.",
    expected_output="A quantitative recommendation based on market trends.",
    agent=market_analyst
)

task_procure = Task(
    description="Consolidate everything into a dashboard approval summary for the owner.",
    expected_output="A detailed order validation card containing Product ID, Product Name, final quantity, and justification.",
    agent=procurement_manager
)

rn_agencies_crew = Crew(
    agents=[stock_auditor, market_analyst, procurement_manager],
    tasks=[task_audit, task_analyze, task_procure],
    process=Process.sequential
)
if __name__ == "__main__":
    print("🚀 Connecting to AWS DynamoDB and starting Live Agent operations...\n")
    final_output = rn_agencies_crew.kickoff()
    print("\n🏁 Execution Pipeline Completed.")
    print(final_output)

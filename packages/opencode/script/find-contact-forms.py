import os
import json
from tavily import TavilyClient
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()

# Initialize Tavily client
api_key = os.getenv("TAVILY_API_KEY")
if not api_key:
    raise ValueError("TAVILY_API_KEY not found in .env file")

client = TavilyClient(api_key=api_key)

def find_contact_form(company_name: str, city: str = "") -> dict:
    """
    Search for contact form URLs for a given company.
    
    Args:
        company_name: Name of the company to search for
        city: Optional city/location to narrow search
    
    Returns:
        Dictionary with company info and found contact form URL
    """
    # Build search query
    query = f"{company_name} contact form"
    if city:
        query = f"{company_name} {city} contact form"
    
    try:
        # Search using Tavily API
        response = client.search(
            query=query,
            search_depth="basic",
            max_results=5,
            include_answer=False,
            include_raw_content=False
        )
        
        # Extract contact form URLs from results
        contact_url = None
        website_url = None
        
        for result in response.get("results", []):
            url = result.get("url", "")
            title = result.get("title", "").lower()
            content = result.get("content", "").lower()
            
            # Store the first result as potential website
            if not website_url:
                website_url = url
            
            # Look for contact page indicators
            if any(keyword in url.lower() for keyword in ["contact", "get-in-touch", "reach"]):
                contact_url = url
                break
            
            # Check title and content for contact-related keywords
            if any(keyword in title for keyword in ["contact", "get in touch", "reach out"]):
                contact_url = url
                break
            
            if any(keyword in content for keyword in ["contact form", "contact us", "get in touch"]):
                contact_url = url
                break
        
        return {
            "company": company_name,
            "city": city,
            "website": website_url,
            "contact_form_url": contact_url,
            "status": "found" if contact_url else "not_found",
            "search_query": query,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "company": company_name,
            "city": city,
            "website": None,
            "contact_form_url": None,
            "status": "error",
            "error": str(e),
            "search_query": query,
            "timestamp": datetime.now().isoformat()
        }

def process_worklist(input_file: str, output_file: str, limit: int | None = None):
    """
    Process bounce followup worklist and find contact forms.
    
    Args:
        input_file: Path to bounce-followup-worklist.json
        output_file: Path to save contact-forms-found.json
        limit: Maximum number of companies to process (default: all)
    """
    # Load worklist
    with open(input_file, "r") as f:
        worklist = json.load(f)
    
    # Clean up worklist - filter out invalid entries
    cleaned_worklist = []
    for entry in worklist:
        company = entry.get("company", "")
        # Skip entries that are just emails or "Lead Profile:" prefixes
        if not company or company.startswith("Lead Profile:") or "@" in company:
            continue
        cleaned_worklist.append(entry)
    
    # Limit if specified
    if limit:
        cleaned_worklist = cleaned_worklist[:limit]
    
    results = []
    
    print(f"Processing {len(cleaned_worklist)} companies...")
    
    for i, entry in enumerate(cleaned_worklist, 1):
        company = entry.get("company", "")
        website = entry.get("website", "")
        
        # Extract city from email domain or use empty string
        # For now, we'll search without city if not available
        city = ""
        
        print(f"[{i}/{len(cleaned_worklist)}] Searching: {company}")
        
        result = find_contact_form(company, city)
        
        # Add original email if available
        result["original_email"] = entry.get("email", "")
        result["original_website"] = website
        
        results.append(result)
        
        # Print result
        if result["contact_form_url"]:
            print(f"  ✓ Found: {result['contact_form_url']}")
        else:
            print(f"  ✗ Not found")
    
    # Save results
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\nResults saved to: {output_file}")
    print(f"Total: {len(results)} companies")
    print(f"Found: {sum(1 for r in results if r['status'] == 'found')}")
    print(f"Not found: {sum(1 for r in results if r['status'] == 'not_found')}")
    print(f"Errors: {sum(1 for r in results if r['status'] == 'error')}")

if __name__ == "__main__":
    # Process first 5 companies for testing
    input_file = "outreach/queues/bounce-followup-worklist.json"
    output_file = "outreach/queues/contact-forms-found.json"
    
    process_worklist(input_file, output_file, limit=5)

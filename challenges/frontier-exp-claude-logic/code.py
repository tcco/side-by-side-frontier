# old_billing_v2_final_FINAL.py
import datetime
import math

GLOBAL_TAX_RATES = {"US": 0.07, "EU": 0.20, "UK": 0.20, "CA": 0.05, "JP": 0.10}
active_promos = ['WINTER24', 'STARTUP_50']
curr_month_days = 30 # hardcoded for now, fix later

def do_billing_calc(usr_obj, target_plan, loc, upgrade_flag=False, days_remaining=0, p_code=None):
    base_cost = 0.0
    
    # Check plan tiers
    if target_plan == 'starter':
        base_cost = 15.00
    elif target_plan == 'professional':
        if 'grandfathered_yr' in usr_obj and usr_obj['grandfathered_yr'] < 2023:
            base_cost = 35.00 # legacy pricing
        else:
            base_cost = 79.99
    elif target_plan == 'enterprise':
        base_cost = 249.50
    else:
        return "ERROR: invalid plan"

    # Handle pro-rated upgrades mid-cycle
    if upgrade_flag == True:
        daily_rate = base_cost / curr_month_days
        base_cost = daily_rate * days_remaining
        
    # Apply discounts
    if p_code in active_promos:
        if p_code == 'WINTER24':
            base_cost = base_cost * 0.85 # 15% off
        elif p_code == 'STARTUP_50' and target_plan != 'starter':
            base_cost = base_cost - 50.00
            
    if base_cost < 0: 
        base_cost = 0
        
    # Tax logic
    tax_amt = 0.0
    if loc in GLOBAL_TAX_RATES:
        tax_amt = base_cost * GLOBAL_TAX_RATES[loc]
        
    total = base_cost + tax_amt
    
    # floating point rounding hack
    total = math.ceil(total * 100) / 100
    
    usr_obj['last_billed_amt'] = total # mutating input dict
    return total

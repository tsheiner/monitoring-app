  Ideas for Incident Simulation (Future)                                                                                                               
                                                                                                                                                       
  Having looked at the code, here's how incident simulation could work:                                                                                
                                                                                                                                                       
  Concept: "Incident Scenarios"                                                                                                                        
                                                                                                                                                       
  Each scenario is a story with:                                                                                                                       
  - Trigger event (e.g., device_crash on AP-Floor2-01)                                                                                                 
  - Duration (e.g., 15-45 minutes)                                                                                                                     
  - Metric impacts (multipliers applied during incident)                                                                                               
  - Resolution event (e.g., device_restart or ai_action)                                                                                               
                                                                                                                                                       
  Example Scenarios:                                                                                                                                   
  ┌──────────────┬─────────────────────────┬────────────────────────────────────────────────────────────────────┬──────────────────────┐               
  │   Scenario   │         Trigger         │                               Impact                               │       Duration       │               
  ├──────────────┼─────────────────────────┼────────────────────────────────────────────────────────────────────┼──────────────────────┤               
  │ AP Failure   │ device_crash            │ time_to_connect +50%, throughput -40%, capacity +30% on nearby APs │ 10-30 min            │               
  ├──────────────┼─────────────────────────┼────────────────────────────────────────────────────────────────────┼──────────────────────┤               
  │ Interference │ config_change (channel) │ coverage -10dBm, throughput -30%                                   │ 5-20 min             │               
  ├──────────────┼─────────────────────────┼────────────────────────────────────────────────────────────────────┼──────────────────────┤               
  │ Overload     │ (capacity > 80%)        │ time_to_connect +100%, success_rate -5%                            │ until capacity drops │               
  ├──────────────┼─────────────────────────┼────────────────────────────────────────────────────────────────────┼──────────────────────┤               
  │ Firmware Bug │ firmware_update         │ random metric degradation                                          │ until next restart   │               
  └──────────────┴─────────────────────────┴────────────────────────────────────────────────────────────────────┴──────────────────────┘               
  Implementation Approach:                                                                                                                             
                                                                                                                                                       
  1. Add ActiveIncident state to the metrics generator:                                                                                                
  active_incidents: List[{                                                                                                                             
      start_time, end_time, affected_entities,                                                                                                         
      metric_modifiers: {metric: multiplier}                                                                                                           
  }]                                                                                                                                                   
  2. During value calculation, check for active incidents and apply modifiers                                                                          
  3. For historical data, pre-generate incident timeline before generating metrics, so the correlation is baked in                                     
  4. For live data, expose API endpoint to trigger incidents:                                                                                          
  POST /api/incidents/trigger {scenario: "ap_failure", entity: "AP-Floor2-01"}                                                                         
  5. Auto-resolution: Incidents auto-resolve after duration, generating a resolution event                                                             
                                                                                                                                                       
  This keeps the correlation tight since the same incident state affects both event generation AND metric generation.

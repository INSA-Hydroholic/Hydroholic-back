import 'dotenv/config'; // Charge ta WEATHER_API_KEY
import { HydrationService, WeatherService } from './src/service/hydration.service.ts';

async function testRecommendation() {
    console.log("--- TEST DE RECOMMANDATION D'EAU ---");

    const mockUser = {
        city: "lyon", 
        weight: 61,
        age: 21,
        gender: 'F' as 'H' | 'F',
        intenseMin: 180,   
        moderateMin: 180,  
    };

    console.log(`📍 Ville : ${mockUser.city}`);
    console.log(`⚖️ Poids : ${mockUser.weight}kg | Sport : 90min au total`);

    try {
        // 2. Appel de l'API Météo
        console.log("... Récupération de la météo en cours ...");
        const temperature = await WeatherService.getTemperatureByCity(mockUser.city);
        console.log(` Température actuelle à ${mockUser.city} : ${temperature}°C`);

        // 3. Calcul de la recommandation
        const finalGoal = HydrationService.calculatePersonalizedGoal({
            weight: mockUser.weight,
            age: mockUser.age,
            gender: mockUser.gender,
            intenseMin: mockUser.intenseMin,
            moderateMin: mockUser.moderateMin,
            temp: temperature // On passe la température récupérée
        });

        // 4. Affichage du résultat
        console.log("\n--- RESULTAT ---");
        console.log(`Objectif quotidien calculé : ${finalGoal} ml`);
        console.log("---------------------------------");

    } catch (error) {
        console.error("Le test a échoué :", error);
    }
}

testRecommendation();
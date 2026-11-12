from datetime import date

from fastapi import HTTPException

from .config import settings


def calculate(age: int, height_cm: float, weight_kg: float, sex: str, activity: str, goal: str) -> dict:
    if age < 18:
        raise HTTPException(422, "Tính thực đơn tự động hiện chỉ hỗ trợ người từ 18 tuổi; cần chuyên gia đánh giá cho trẻ vị thành niên.")
    if age > 120:
        raise HTTPException(422, "Ngày sinh không hợp lệ để tính nhu cầu dinh dưỡng.")
    if not all((height_cm, weight_kg, sex, activity, goal)):
        raise HTTPException(422, "Cần bổ sung chiều cao, cân nặng, giới tính tính toán, mức vận động, mục tiêu và ngày sinh.")
    bmi = weight_kg / (height_cm / 100) ** 2
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + (5 if sex == "male" else -161)
    factor = settings.activity_factors[activity]
    tdee = bmr * factor
    proposed = tdee * (1 + settings.calorie_adjustment[goal])
    protein_factor = settings.protein_factors[goal] + settings.activity_protein_bonus[activity]
    protein_g = weight_kg * protein_factor
    # Keep the protein target within a practical share of the energy target.
    uncapped_protein_g = protein_g
    protein_g = min(max(protein_g, proposed * 0.15 / 4), proposed * 0.25 / 4)
    fat_fraction = min(max(settings.fat_energy_fraction, 0.20), 0.35)
    fat_g = proposed * fat_fraction / 9
    carb_g = max(0.0, (proposed - protein_g * 4 - fat_g * 9) / 4)
    macro_energy = protein_g * 4 + carb_g * 4 + fat_g * 9
    warnings = []
    if protein_g != uncapped_protein_g:
        warnings.append("Mục tiêu protein theo g/kg đã được giới hạn để tỷ lệ năng lượng đa lượng còn lại nằm trong phạm vi cấu hình.")
    # Configurable conservative safety bounds; preserve proposed number and report flags.
    safe_min, safe_max = settings.calorie_minimum, settings.calorie_maximum
    if proposed < safe_min or proposed > safe_max:
        warnings.append(f"Mức calo tham khảo {proposed:.0f} kcal nằm ngoài ngưỡng cấu hình {safe_min:.0f}–{safe_max:.0f}; cần chuyên gia xem xét, hệ thống không tự điều chỉnh.")
    if bmi < 18.5:
        bmi_comment = "BMI thấp hơn khoảng tham chiếu người trưởng thành; BMI chỉ là chỉ số sàng lọc."
    elif bmi < 25:
        bmi_comment = "BMI trong khoảng tham chiếu thường dùng cho người trưởng thành; BMI không chẩn đoán sức khỏe."
    elif bmi < 30:
        bmi_comment = "BMI cao hơn khoảng tham chiếu thường dùng; BMI chỉ là chỉ số sàng lọc."
    else:
        bmi_comment = "BMI cao hơn khoảng tham chiếu thường dùng; BMI chỉ là chỉ số sàng lọc, không tự chẩn đoán."
    review_required = (bmi < 16 or bmi >= 40 or (goal == "lose_weight" and bmi < 18.5)
                      or (goal == "gain_weight" and bmi >= 30))
    if review_required:
        warnings.append("Thông tin đầu vào thuộc trường hợp cần chuyên gia đánh giá trước khi tạo thực đơn tự động.")
    return {
        "bmi": round(bmi, 2), "bmi_comment": bmi_comment,
        "bmr_kcal": round(bmr, 1), "tdee_kcal": round(tdee, 1),
        "target_calories": round(proposed, 1),
        "protein_g": round(protein_g, 1),
        "carb_g": round(carb_g, 1),
        "fat_g": round(fat_g, 1),
        "macro_energy_kcal": round(macro_energy, 1),
        "medical_review_required": review_required,
        "formula": {
            "bmi": "weight_kg / (height_cm / 100)^2",
            "bmr": "10 × weight_kg + 6.25 × height_cm - 5 × age + sex_constant",
            "sex_constant": 5 if sex == "male" else -161,
            "activity_factor": factor, "tdee": "BMR × activity_factor",
            "goal_adjustment_fraction": settings.calorie_adjustment[goal],
            "target": "TDEE × (1 + goal_adjustment_fraction)",
            "protein": f"weight_kg × (goal_factor + activity_bonus) = {protein_factor} g/kg, giới hạn 15–25% năng lượng",
            "protein_factor_g_per_kg": protein_factor,
            "fat": f"{fat_fraction * 100:.0f}% target_calories / 9 kcal/g",
            "fat_energy_fraction": fat_fraction,
            "carb": "(target_calories - protein_g × 4 - fat_g × 9) / 4",
            "macro_calories": "protein_g × 4 + carb_g × 4 + fat_g × 9",
            "calorie_safety_bounds": {"minimum": safe_min, "maximum": safe_max},
        },
        "warnings": warnings,
    }


def age_on(dob: date, at: date) -> int:
    return at.year - dob.year - ((at.month, at.day) < (dob.month, dob.day))
